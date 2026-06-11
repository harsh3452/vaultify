import datetime
import hashlib
import uuid
from flask import Blueprint, jsonify, request
from auth import db, firebase_required
from storage_manager import storage_engine
from gdrive_manager import gdrive_engine
from ai_engine import current_brain, gemini_brain, id_classifier
from kms_manager import kms_engine

upload_bp = Blueprint("upload_bp", __name__)


def _load_helpers():
    from services.storage_service import (
        _decrypt_user_token,
        _build_gdrive_filename,
        _download_doc_bytes,
    )
    from services.client_service import (
        TYPE_MAP,
        find_or_create_client,
        _get_or_create_pending_folder,
    )
    from services.activity_service import log_activity

    return {
        "_decrypt_user_token": _decrypt_user_token,
        "_build_gdrive_filename": _build_gdrive_filename,
        "TYPE_MAP": TYPE_MAP,
        "find_or_create_client": find_or_create_client,
        "_get_or_create_pending_folder": _get_or_create_pending_folder,
        "log_activity": log_activity,
        "_download_doc_bytes": _download_doc_bytes,
    }


@upload_bp.route("/upload", methods=["POST"])
@firebase_required
def upload():
    helpers = _load_helpers()
    _decrypt_user_token = helpers["_decrypt_user_token"]
    _build_gdrive_filename = helpers["_build_gdrive_filename"]
    TYPE_MAP = helpers["TYPE_MAP"]
    find_or_create_client = helpers["find_or_create_client"]
    _get_or_create_pending_folder = helpers["_get_or_create_pending_folder"]
    log_activity = helpers["log_activity"]

    owner_id = request.firebase_uid
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files"}), 400

    # Determine storage backend (Firebase or Google Drive)
    user_profile = db.users.find_one({"uid": owner_id})
    use_gdrive = user_profile and user_profile.get("storage_mode") == "gdrive"
    gdrive_service = None

    if use_gdrive:
        refresh_token = _decrypt_user_token(owner_id, user_profile.get("gdrive_refresh_token_enc"))
        access_token = _decrypt_user_token(owner_id, user_profile.get("gdrive_access_token_enc"))

        if not refresh_token and not access_token:
            return jsonify({"error": "Google Drive not connected. Please reconnect via Settings."}), 500
        try:
            gdrive_service = gdrive_engine.get_auth_service(
                refresh_token=refresh_token,
                access_token=access_token,
            )
            print(f"✅ UPLOAD: Using Google Drive storage for user {owner_id}")
        except Exception as e:
            return jsonify({"error": f"Failed to authenticate with Google Drive: {str(e)}"}), 503
    else:
        print(f"✅ UPLOAD: Using Firebase storage for user {owner_id}")

    results, errors = [], []

    for file in files:
        fname = file.filename
        if not fname:
            continue
        try:
            # Read raw bytes and compute SHA-256 for deduplication
            raw_bytes = file.read()
            content_hash = hashlib.sha256(raw_bytes).hexdigest()

            # Content-hash duplicate: if present, return link to existing doc
            dup_client = db.clients.find_one({
                "owner_id": owner_id,
                "documents": {"$elemMatch": {
                    "content_hash": content_hash,
                    "deleted_at": {"$exists": False},
                }},
            })
            if dup_client:
                dup_doc = next((d for d in dup_client.get("documents", []) if d.get("content_hash") == content_hash and not d.get("deleted_at")), None)
                errors.append({
                    "filename": fname,
                    "error": "Duplicate — already stored",
                    "dup_doc_id": (dup_doc or {}).get("doc_id"),
                    "dup_client": dup_client.get("name"),
                })
                continue

            # Create a new doc entry and store the raw bytes into the owner's inbox
            doc_id = str(uuid.uuid4())
            firebase_path = None
            gdrive_file_id = None
            storage_backend = "firebase"
            stored_size = len(raw_bytes)

            # Ensure we have a pending client (inbox) to attach this doc to
            client = _get_or_create_pending_folder(owner_id)

            if use_gdrive:
                # Upload raw bytes to a Vaultify/Unsorted folder for this user
                try:
                    client_name_stub = client.get("name", "Unsorted_Pending").replace(" ", "_").upper()
                    gdrive_folder_id = gdrive_engine.create_folder_hierarchy(gdrive_service, client_name_stub, "Unsorted")
                    gdrive_filename = _build_gdrive_filename("Unsorted", doc_id)
                    file_obj = gdrive_engine.upload_file(gdrive_service, raw_bytes, gdrive_filename, gdrive_folder_id)
                    gdrive_file_id = file_obj.get("id")
                    storage_backend = "gdrive"
                    firebase_path = None
                    print(f"✅ UPLOAD (inbox): {fname} uploaded to GDrive id={gdrive_file_id}")
                except Exception as e:
                    print(f"❌ GDrive inbox upload failed for {fname}: {e}")
                    errors.append({"filename": fname, "error": f"GDrive upload failed: {e}"})
                    continue
            else:
                # Upload raw bytes encrypted/plain to Firebase inbox (docs path)
                try:
                    dek = kms_engine.get_or_create_dek(owner_id, db)
                    firebase_path, stored_size = storage_engine.upload_encrypted(raw_bytes, owner_id, doc_id, dek)
                    storage_backend = "firebase"
                    print(f"✅ UPLOAD (inbox): {fname} stored at {firebase_path}")
                except Exception as e:
                    print(f"❌ Firebase inbox upload failed for {fname}: {e}")
                    errors.append({"filename": fname, "error": f"Storage upload failed: {e}"})
                    continue

            # Create DB entry (queued) and enqueue background processing task
            doc_entry = {
                "doc_id": doc_id,
                "filename": fname,
                "storage_filename": None,
                "content_hash": content_hash,
                "type": "Unsorted",
                "firebase_path": firebase_path,
                "gdrive_file_id": gdrive_file_id,
                "storage_backend": storage_backend,
                "needs_review": True,
                "status": "queued",
                "match_type": "queued_upload",
                "file_size": stored_size,
                "uploaded_at": datetime.datetime.now(),
                "queued_at": datetime.datetime.now(),
            }

            db.clients.update_one({"_id": client["_id"]}, {"$push": {"documents": doc_entry}})

            # Enqueue background AI analysis (runs in a daemon thread)
            try:
                from tasks.reanalyze_tasks import reanalyze_document
                reanalyze_document(owner_id, doc_id)
                # No task.id anymore — the thread handles it asynchronously
            except Exception as e:
                print(f"⚠️ Failed to enqueue background task for {doc_id}: {e}")

            # Log upload activity
            activity_path = firebase_path or f"gdrive:{gdrive_file_id or ''}"
            extra = None
            if storage_backend == "gdrive":
                extra = {"storage_backend": "gdrive", "gdrive_file_id": gdrive_file_id}
            log_activity(owner_id, doc_id, client["_id"], activity_path, fname, "Unsorted", "upload", client_name=client.get("name", ""), extra=extra)

            results.append({"filename": fname, "doc_id": doc_id, "status": "queued"})

        except Exception as e:
            print(f"❌ {fname}: {e}")
            errors.append({"filename": fname, "error": str(e)})

    status = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status


@upload_bp.route("/retry-pending", methods=["POST"])
@firebase_required
def retry_pending():
    owner_id = request.firebase_uid

    pending_folder = db.clients.find_one({"owner_id": owner_id, "name": "Unsorted_Pending"})
    if not pending_folder:
        return jsonify({"retried": 0, "message": "No pending documents"}), 200

    pending_docs = [
        d for d in pending_folder.get("documents", [])
        if d.get("status") in ("pending", "failed") and not d.get("deleted_at")
    ]
    if not pending_docs:
        return jsonify({"retried": 0, "message": "No pending documents"}), 200

    enqueued = 0
    from tasks.reanalyze_tasks import reanalyze_document

    for doc in pending_docs:
        doc_id = doc["doc_id"]
        try:
            reanalyze_document(owner_id, doc_id)
            db.clients.update_one(
                {"_id": pending_folder["_id"], "documents.doc_id": doc_id},
                {
                    "$set": {
                        "documents.$.status": "queued",
                        "documents.$.queued_at": datetime.datetime.now(),
                    },
                },
            )
            enqueued += 1
        except Exception as e:
            print(f"    ❌ Retry enqueue failed for {doc_id}: {e}")

    from services.client_service import _cleanup_empty_client
    _cleanup_empty_client(pending_folder["_id"])

    return jsonify({"retried": enqueued, "failed": []}), 200
