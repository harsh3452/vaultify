"""
Background AI document analysis using threading (replaces Celery).

All AI-heavy work runs in a daemon thread so the user can upload and leave.
Tasks update document status in MongoDB as they progress.

After analysis, the task:
  1. Runs the original bytes through the ID classifier + AI
  2. Creates a storage-grade compressed WebP artifact
  3. Uploads it to the correct folder (Vaultify/<ClientName>/<DocType>/ on GDrive,
     or user_id/docs/<doc_id>.webp on Firebase)
  4. Deletes the old inbox/temporary raw copy
  5. Updates all DB fields including storage_filename, content_hash, compressed_hash, file_size
"""
import traceback
import datetime
import threading
from auth import db
from services.storage_service import (
    _download_doc_bytes,
    _store_final_artifact,
)
from services.client_service import (
    find_or_create_client,
    _cleanup_empty_client,
    _update_client_fields,
    TYPE_MAP,
    UNKNOWN_CLIENT_NAMES,
)
from services.activity_service import log_activity
from ai_engine import current_brain, gemini_brain, id_classifier


def _set_doc_status(owner_id, doc_id, status, **extra_updates):
    """Update the status field (and any extra fields) on a document in-place."""
    update = {"documents.$.status": status}
    for k, v in extra_updates.items():
        update[f"documents.$.{k}"] = v
    db.clients.update_one(
        {"owner_id": owner_id, "documents.doc_id": doc_id},
        {"$set": update},
    )


def _reanalyze_worker(owner_id, doc_id):
    """Run AI analysis on a document and update DB. Runs in a background thread."""
    try:
        _set_doc_status(owner_id, doc_id, "processing", started_at=datetime.datetime.now())

        old_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not old_client:
            return

        doc = next((d for d in old_client["documents"] if d["doc_id"] == doc_id), None)
        if not doc:
            return

        # 1. Download file bytes from inbox (GDrive or Firebase)
        file_bytes = _download_doc_bytes(doc, owner_id)

        # 2. Run ID classifier (if available)
        classifier_result = id_classifier.classify(file_bytes) if id_classifier.available else None
        if classifier_result is not None and classifier_result["confidence"] < id_classifier.CONFIDENCE_THRESHOLD:
            classifier_result = None

        # 3. Primary AI: LM Studio
        ai_data = current_brain.analyze(file_bytes, classifier_result=classifier_result)

        # 4. Fallback: if LM Studio unreachable, try Gemini
        if ai_data.get("method") == "ai_unreachable" and gemini_brain.available:
            print(f"    🔄 LM Studio unreachable — trying Gemini fallback for {doc_id}")
            ai_data = gemini_brain.analyze(file_bytes, classifier_result=classifier_result)

        # If still unreachable, mark as pending
        if ai_data.get("method") == "ai_unreachable":
            _set_doc_status(owner_id, doc_id, "pending")
            print(f"    ⏳ AI unreachable — {doc_id} marked pending for retry")
            return

        # Not a document -> remove from pending cleanly
        if ai_data.get("document_type") == "Not_A_Document":
            old_client_ref = db.clients.find_one({"_id": old_client["_id"]})
            if old_client_ref and old_client_ref.get("name") == "Unsorted_Pending":
                db.clients.update_one(
                    {"_id": old_client["_id"]},
                    {"$pull": {"documents": {"doc_id": doc_id}}},
                )
                _cleanup_empty_client(old_client["_id"])
                print(f"    🚫 '{doc.get('filename')}' is not a KYC document — removed")
                return

        # 5. Map AI type -> display type
        detected_type = TYPE_MAP.get(
            (ai_data.get("document_type") or "").upper().replace(" ", "_"),
            ai_data.get("document_type") or "Unsorted",
        )

        # 6. Find or create client
        new_client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
        is_unknown = (new_client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES

        has_strong_uid = bool(ai_data.get("pan_number") or ai_data.get("voter_id_number") or ai_data.get("dl_number"))
        a_last4_val = ai_data.get("aadhaar_last4") or ""
        client_name = (new_client.get("name") or "").upper()
        dob = (ai_data.get("date_of_birth") or "").replace("/", "").replace("-", "")
        confident = has_strong_uid or (client_name and dob) or (client_name and a_last4_val)
        needs_review = is_unknown or not confident

        same_client = str(old_client["_id"]) == str(new_client["_id"])

        # 7. Create storage-grade artifact, upload to correct location, delete inbox
        artifact_meta = _store_final_artifact(
            owner_id=owner_id,
            doc_id=doc_id,
            raw_bytes=file_bytes,
            client_name=new_client.get("name", "Unsorted"),
            doc_type=detected_type,
            old_doc=doc,
            gdrive_service=None,
        )

        # 8. Build the full doc_meta
        doc_meta = {
            "type": detected_type,
            "needs_review": needs_review,
            "match_type": match_type,
            "client_name": ai_data.get("client_name") or "",
            "date_of_birth": ai_data.get("date_of_birth") or "",
            "pan_number": ai_data.get("pan_number") or "",
            "aadhaar_last4": ai_data.get("aadhaar_last4") or "",
            "voter_id_number": ai_data.get("voter_id_number") or "",
            "dl_number": ai_data.get("dl_number") or "",
            "card_side": ai_data.get("card_side", doc.get("card_side", "front")),
            "status": "needs_review" if needs_review else "processed",
            "finished_at": datetime.datetime.now(),
            "storage_filename": artifact_meta["storage_filename"],
            "file_size": artifact_meta["stored_size"],
            "content_hash": artifact_meta["content_hash"],
            "compressed_hash": artifact_meta["compressed_hash"],
            "firebase_path": artifact_meta["firebase_path"],
            "gdrive_file_id": artifact_meta["gdrive_file_id"],
            "storage_backend": artifact_meta["storage_backend"],
        }

        _ = artifact_meta.pop("_gdrive_service", None)

        if same_client:
            db.clients.update_one(
                {"_id": old_client["_id"], "documents.doc_id": doc_id},
                {"$set": {f"documents.$.{k}": v for k, v in doc_meta.items()}},
            )
            _update_client_fields(old_client["_id"], ai_data)
        else:
            updated_doc = {**doc, **doc_meta}
            db.clients.update_one({"_id": old_client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
            db.clients.update_one({"_id": new_client["_id"]}, {"$push": {"documents": updated_doc}})
            refreshed_old = db.clients.find_one({"_id": old_client["_id"]})
            if refreshed_old and not any(d.get("needs_review") for d in refreshed_old.get("documents", [])):
                db.clients.update_one({"_id": old_client["_id"]}, {"$set": {"needs_review": False}})
            _cleanup_empty_client(old_client["_id"])

        if not is_unknown:
            refreshed_new = db.clients.find_one({"_id": new_client["_id"]})
            if refreshed_new and not any(d.get("needs_review") for d in refreshed_new.get("documents", [])):
                db.clients.update_one({"_id": new_client["_id"]}, {"$set": {"needs_review": False}})

        # 9. Log activity
        activity_path = artifact_meta.get("firebase_path") or f"gdrive:{artifact_meta.get('gdrive_file_id', '')}"
        extra = None
        if artifact_meta.get("storage_backend") == "gdrive" or artifact_meta.get("gdrive_file_id"):
            extra = {"storage_backend": "gdrive", "gdrive_file_id": artifact_meta.get("gdrive_file_id")}
        log_activity(
            owner_id, doc_id, new_client["_id"], activity_path,
            doc.get("filename", ""), detected_type, "reanalyze",
            client_name=new_client.get("name", ""), extra=extra,
        )

        print(f"    ✅ Thread OK: {doc_id} -> {new_client.get('name')} / {detected_type} | review={needs_review} | stored={artifact_meta['stored_size']}b")

    except Exception as e:
        tb = traceback.format_exc()
        print(f"    ❌ Reanalyze thread failed for {doc_id}: {e}\n{tb}")
        try:
            _set_doc_status(owner_id, doc_id, "failed", error=str(e)[:500])
        except Exception:
            pass


def reanalyze_document(owner_id, doc_id):
    """Enqueue a document for background AI analysis. Returns immediately."""
    thread = threading.Thread(target=_reanalyze_worker, args=(owner_id, doc_id), daemon=True)
    thread.start()
    print(f"    🧵 Background thread started for {doc_id}")