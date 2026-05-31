import datetime
from flask import Blueprint, jsonify, request
from auth import db, firebase_required
from services.storage_service import _download_doc_bytes, _delete_doc_storage, _get_gdrive_service
from gdrive_manager import gdrive_engine
from services.client_service import (
    TYPE_MAP, UNKNOWN_CLIENT_NAMES, find_or_create_client,
    _cleanup_empty_client, _update_client_fields
)
from services.pii_crypto import decrypt_client_pii
from services.activity_service import log_activity
from ai_engine import current_brain, gemini_brain, id_classifier

documents_bp = Blueprint("documents_bp", __name__)


@documents_bp.route('/delete/client', methods=['DELETE'])
@firebase_required
def delete_client():
    owner_id    = request.firebase_uid
    client_name = request.args.get('client')
    if not client_name:
        return jsonify({"error": "Missing client"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "name": client_name.upper()})
    if not client:
        return jsonify({"error": "Client not found"}), 404

    success, failed = [], []
    gdrive_service = None
    for doc in client.get("documents", []):
        try:
            if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
                if not gdrive_service:
                    gdrive_service = _get_gdrive_service(owner_id)
                _delete_doc_storage(doc, owner_id, gdrive_service=gdrive_service)
                success.append(f"gdrive:{doc.get('gdrive_file_id', '')}")
            else:
                _delete_doc_storage(doc, owner_id)
                success.append(doc.get("firebase_path", ""))
        except Exception as e:
            failed.append({
                "doc_id": doc.get("doc_id"),
                "path": doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}",
                "error": str(e)
            })

    db.clients.delete_one({"_id": client["_id"]})
    status = 207 if failed and success else (400 if failed else 200)
    return jsonify({"deleted": len(success), "failed": len(failed)}), status


@documents_bp.route('/documents/star', methods=['POST'])
@firebase_required
def toggle_star():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc     = next(d for d in client["documents"] if d["doc_id"] == doc_id)
    new_val = not doc.get("starred", False)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.starred": new_val}}
    )
    activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
    extra = None
    if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
        extra = {
            "storage_backend": "gdrive",
            "gdrive_file_id": doc.get("gdrive_file_id")
        }
    log_activity(owner_id, doc_id, client["_id"], activity_path,
                 doc.get("filename", ""), doc.get("type", ""),
                 "star" if new_val else "unstar", client_name=client.get("name", ""), extra=extra)
    return jsonify({"starred": new_val}), 200


@documents_bp.route('/documents/starred', methods=['GET'])
@firebase_required
def get_starred():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))
    results  = []
    for c in clients:
        for doc in c.get("documents", []):
            if doc.get("starred") and not doc.get("deleted_at"):
                d = {**doc, "client_name": c["name"]}
                if hasattr(d.get("uploaded_at"), "strftime"):
                    d["uploaded_at"] = d["uploaded_at"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(d)
    return jsonify({"results": results}), 200


@documents_bp.route('/documents/trash', methods=['POST'])
@firebase_required
def trash_doc():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": datetime.datetime.now(),
                  "documents.$.starred":    False}}
    )
    if doc:
        activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
        extra = None
        if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
            extra = {
                "storage_backend": "gdrive",
                "gdrive_file_id": doc.get("gdrive_file_id")
            }
        log_activity(owner_id, doc_id, client["_id"], activity_path,
                     doc.get("filename", ""), doc.get("type", ""), "trash",
                     client_name=client.get("name", ""), extra=extra)
    return jsonify({"message": "Moved to trash"}), 200


@documents_bp.route('/documents/trash', methods=['GET'])
@firebase_required
def get_trash():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))
    results  = []
    for c in clients:
        for doc in c.get("documents", []):
            if doc.get("deleted_at"):
                d = {**doc, "client_name": c["name"]}
                if hasattr(d.get("deleted_at"), "strftime"):
                    d["deleted_at"] = d["deleted_at"].strftime("%Y-%m-%d %H:%M:%S")
                if hasattr(d.get("uploaded_at"), "strftime"):
                    d["uploaded_at"] = d["uploaded_at"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(d)
    return jsonify({"results": results}), 200


@documents_bp.route('/documents/restore', methods=['POST'])
@firebase_required
def restore_doc():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": None}}
    )
    if doc:
        activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
        extra = None
        if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
            extra = {
                "storage_backend": "gdrive",
                "gdrive_file_id": doc.get("gdrive_file_id")
            }
        log_activity(owner_id, doc_id, client["_id"], activity_path,
                     doc.get("filename", ""), doc.get("type", ""), "restore",
                     client_name=client.get("name", ""), extra=extra)
    return jsonify({"message": "Restored"}), 200


@documents_bp.route('/documents/trash/purge', methods=['DELETE'])
@firebase_required
def purge_doc():
    owner_id = request.firebase_uid
    doc_id   = request.args.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    try:
        if doc:
            _delete_doc_storage(doc, owner_id)
    except Exception:
        pass
    db.clients.update_one({"_id": client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
    updated = db.clients.find_one({"_id": client["_id"]})
    if updated and len(updated.get("documents", [])) == 0:
        db.clients.delete_one({"_id": client["_id"]})
    return jsonify({"message": "Permanently deleted"}), 200


@documents_bp.route('/documents/type', methods=['PATCH'])
@firebase_required
def update_doc_type():
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    new_type = data.get('type')
    if not doc_id or not new_type:
        return jsonify({"error": "Missing doc_id or type"}), 400
    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.type": new_type, "documents.$.needs_review": False}}
    )
    return jsonify({"message": "Updated", "type": new_type}), 200


@documents_bp.route('/documents/metadata', methods=['PATCH'])
@firebase_required
def update_doc_metadata():
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    old_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not old_client:
        return jsonify({"error": "Not found"}), 404

    doc = next((d for d in old_client["documents"] if d["doc_id"] == doc_id), None)
    if not doc:
        return jsonify({"error": "Document entry missing"}), 404

    ai_data = {}
    for field in ("name", "dob", "pan_number", "aadhaar_last4", "voter_id_number", "dl_number"):
        val = data.get(field)
        if val is not None:
            ai_data[field] = val.strip() if isinstance(val, str) else val
    if "name" in ai_data:
        ai_data["client_name"] = ai_data["name"]

    submitted_type = data.get('type') or doc.get('type') or 'Unsorted'
    ai_data["document_type"] = next(
        (k for k, v in TYPE_MAP.items() if v == submitted_type),
        submitted_type
    )

    new_client, match_type = find_or_create_client(owner_id, ai_data, submitted_type)

    submitted_name = (ai_data.get("name") or "").strip().replace(" ", "_").upper()
    new_name_upper = (new_client.get("name") or "").upper()
    is_unknown     = new_name_upper in UNKNOWN_CLIENT_NAMES

    # Decrypt stored PII values for the needs_review check
    _decrypted_client = decrypt_client_pii(owner_id, new_client)
    pan    = (ai_data.get("pan_number")      or _decrypted_client.get("pan_number")      or "").strip()
    a_last4 = (ai_data.get("aadhaar_last4")  or new_client.get("aadhaar_last4")         or "").strip()
    voter   = (ai_data.get("voter_id_number") or _decrypted_client.get("voter_id_number") or "").strip()
    dl      = (ai_data.get("dl_number")       or _decrypted_client.get("dl_number")       or "").strip()
    dob     = (ai_data.get("dob")             or new_client.get("dob")             or "").replace("/", "").replace("-", "")
    has_uid = bool(pan or a_last4 or voter or dl)
    needs_review = is_unknown or not (dob and has_uid)

    same_client = str(old_client["_id"]) == str(new_client["_id"])

    if same_client:
        doc_updates = {"documents.$.needs_review": needs_review}
        if data.get('type'):
            doc_updates["documents.$.type"] = submitted_type
        db.clients.update_one(
            {"_id": old_client["_id"], "documents.doc_id": doc_id},
            {"$set": doc_updates}
        )
        _update_client_fields(old_client["_id"], ai_data)
    else:
        updated_doc = {**doc, "type": submitted_type, "needs_review": needs_review, "match_type": match_type}
        db.clients.update_one({"_id": old_client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
        db.clients.update_one({"_id": new_client["_id"]}, {"$push": {"documents": updated_doc}})
        refreshed_old = db.clients.find_one({"_id": old_client["_id"]})
        if refreshed_old and not any(d.get("needs_review") for d in refreshed_old.get("documents", [])):
            db.clients.update_one({"_id": old_client["_id"]}, {"$set": {"needs_review": False}})
        _cleanup_empty_client(old_client["_id"])
        print(f"    🔀 Metadata save reassigned {doc_id}: {old_client['name']} → {new_client['name']}")

    if not is_unknown:
        refreshed_new = db.clients.find_one({"_id": new_client["_id"]})
        if refreshed_new and not any(d.get("needs_review") for d in refreshed_new.get("documents", [])):
            db.clients.update_one({"_id": new_client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({
        "message":    "Metadata updated",
        "doc_id":     doc_id,
        "new_client": new_client["name"],
        "reassigned": not same_client,
    }), 200


@documents_bp.route('/documents/bulk', methods=['POST'])
@firebase_required
def bulk_action():
    owner_id = request.firebase_uid
    data     = request.json
    action   = data.get('action')
    doc_ids  = data.get('doc_ids', [])
    if not doc_ids or not action:
        return jsonify({"error": "Missing action or doc_ids"}), 400

    processed = []
    for doc_id in doc_ids:
        client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not client:
            continue
        doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
        if not doc:
            continue
        try:
            if action == 'trash':
                db.clients.update_one({"_id": client["_id"], "documents.doc_id": doc_id}, {"$set": {"documents.$.deleted_at": datetime.datetime.now()}})
            elif action == 'restore':
                db.clients.update_one({"_id": client["_id"], "documents.doc_id": doc_id}, {"$set": {"documents.$.deleted_at": None}})
            elif action == 'star':
                new_val = not doc.get("starred", False)
                db.clients.update_one({"_id": client["_id"], "documents.doc_id": doc_id}, {"$set": {"documents.$.starred": new_val}})
            elif action == 'reanalyze':
                # Enqueue async Celery task for each doc — user doesn't wait
                try:
                    try:
                        from backend.tasks.reanalyze_tasks import reanalyze_document
                    except ModuleNotFoundError:
                        from tasks.reanalyze_tasks import reanalyze_document

                    task = reanalyze_document.apply_async(args=[owner_id, doc_id], queue="ai")
                    db.clients.update_one(
                        {"_id": client["_id"], "documents.doc_id": doc_id},
                        {
                            "$set": {
                                "documents.$.status": "queued",
                                "documents.$.processing_task": task.id,
                                "documents.$.queued_at": datetime.datetime.now(),
                            },
                        },
                    )
                except Exception as e:
                    print(f"Bulk reanalyze enqueue failed for {doc_id}: {e}")
                    continue
            elif action == 'delete_permanent':
                try:
                    _delete_doc_storage(doc, owner_id)
                except Exception:
                    pass
                db.clients.update_one({"_id": client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
            processed.append(doc_id)
        except Exception as e:
            print(f"Bulk {action} failed for {doc_id}: {e}")

    return jsonify({"processed": len(processed), "doc_ids": processed}), 200


@documents_bp.route('/documents/move', methods=['POST'])
@firebase_required
def move_doc():
    owner_id       = request.firebase_uid
    doc_id         = request.json.get('doc_id')
    target_client_name = (request.json.get('target_client') or "").strip().upper()
    if not doc_id or not target_client_name:
        return jsonify({"error": "Missing doc_id or target_client"}), 400

    src_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not src_client:
        return jsonify({"error": "Document not found"}), 404
    dst_client = db.clients.find_one({"owner_id": owner_id, "name": target_client_name})
    if not dst_client:
        return jsonify({"error": "Target client not found"}), 404
    if str(src_client["_id"]) == str(dst_client["_id"]):
        return jsonify({"error": "Source and target are the same"}), 400

    doc = next((d for d in src_client["documents"] if d["doc_id"] == doc_id), None)
    db.clients.update_one({"_id": src_client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
    db.clients.update_one({"_id": dst_client["_id"]}, {"$push": {"documents": doc}})
    updated_src = db.clients.find_one({"_id": src_client["_id"]})
    if updated_src and len(updated_src.get("documents", [])) == 0:
        db.clients.delete_one({"_id": src_client["_id"]})

    return jsonify({"message": "Moved", "to": target_client_name}), 200


@documents_bp.route('/wipe', methods=['DELETE'])
@firebase_required
def wipe_all_documents():
    """Delete ALL documents for the authenticated user from storage, DB, and activity log.
    
    This is a destructive cleanup — it:
      1. Deletes every file from Firebase Storage / Google Drive
      2. Removes all client/document entries from the `clients` collection
      3. Wipes all activity entries for the user from the `activity` collection
      4. Preserves the user profile in the `users` collection untouched
    """
    owner_id = request.firebase_uid

    # Step 1: Collect all documents across all clients
    clients = list(db.clients.find({"owner_id": owner_id}))
    total_clients = len(clients)
    total_docs = 0
    storage_deleted = 0
    storage_failed = 0

    gdrive_service = None
    # Track unique (client_name, doc_type) pairs for GDrive folder cleanup
    gdrive_folder_keys = set()

    for client in clients:
        client_name = (client.get("name") or "Unsorted").replace(" ", "_").upper()
        for doc in client.get("documents", []):
            total_docs += 1
            doc_type = (doc.get("type") or "Unsorted").replace(" ", "_").upper()
            try:
                if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
                    if not gdrive_service:
                        gdrive_service = _get_gdrive_service(owner_id)
                    _delete_doc_storage(doc, owner_id, gdrive_service=gdrive_service)
                    gdrive_folder_keys.add((client_name, doc_type))
                else:
                    _delete_doc_storage(doc, owner_id)
                storage_deleted += 1
            except Exception as e:
                storage_failed += 1
                print(f"    ⚠️ Wipe: failed to delete storage for {doc.get('doc_id')}: {e}")

    # Step 2: Clean up GDrive folder hierarchy (Vaultify/ClientName/DocType)
    folders_deleted = {"doc_type": 0, "client": 0, "vaultify": 0}
    if gdrive_service and gdrive_folder_keys:
        for client_name, doc_type in gdrive_folder_keys:
            result = gdrive_engine.delete_folder_hierarchy(gdrive_service, client_name, doc_type)
            if result["doc_type"]:
                folders_deleted["doc_type"] += 1
            if result["client"]:
                folders_deleted["client"] += 1
            if result["vaultify"]:
                folders_deleted["vaultify"] += 1
        print(f"🗑️ GDRIVE: Cleaned up {folders_deleted['doc_type']} doc-type, {folders_deleted['client']} client, {folders_deleted['vaultify']} Vaultify folders")

    # Step 3: Remove all clients for this user
    db.clients.delete_many({"owner_id": owner_id})

    # Step 4: Remove all activity entries for this user
    activity_deleted = db.activity.delete_many({"owner_id": owner_id}).deleted_count

    return jsonify({
        "message": "All documents wiped",
        "clients_removed": total_clients,
        "documents_removed": total_docs,
        "storage_files_deleted": storage_deleted,
        "storage_files_failed": storage_failed,
        "gdrive_folders_deleted": folders_deleted,
        "activity_entries_removed": activity_deleted,
    }), 200
