import io
import datetime
import hashlib
import base64
from PIL import Image
from storage_manager import storage_engine
from gdrive_manager import gdrive_engine, TokenExpiredError
from kms_manager import kms_engine
from auth import db
from flask import request


def _download_smart(firebase_path, owner_id):
    """Download file, auto-decrypting if the path ends in .enc."""
    if firebase_path.endswith(".enc"):
        dek = kms_engine.get_or_create_dek(owner_id, db)
        return storage_engine.download_decrypted(firebase_path, dek)
    return storage_engine.download_as_bytes(firebase_path)


def _decrypt_user_token(owner_id, token_enc):
    if not token_enc:
        return None
    try:
        dek = kms_engine.get_or_create_dek(owner_id, db)
        encrypted = base64.urlsafe_b64decode(token_enc.encode("ascii"))
        decrypted = kms_engine.decrypt_bytes(dek, encrypted)
        return decrypted.decode("utf-8")
    except Exception:
        return None


def _get_gdrive_service(owner_id):
    user_profile = db.users.find_one({"uid": owner_id})
    if not user_profile:
        raise ValueError("User profile not found")

    refresh_token = _decrypt_user_token(owner_id, user_profile.get("gdrive_refresh_token_enc"))
    access_token = _decrypt_user_token(owner_id, user_profile.get("gdrive_access_token_enc"))

    if not refresh_token and not access_token:
        raise ValueError("Google Drive tokens missing")

    try:
        return gdrive_engine.get_auth_service(refresh_token=refresh_token, access_token=access_token)
    except TokenExpiredError:
        # Token is dead — clear stored tokens so frontend shows "not connected"
        db.users.update_one(
            {"uid": owner_id},
            {"$unset": {
                "gdrive_refresh_token_enc": "",
                "gdrive_access_token_enc": "",
                "gdrive_refresh_token": "",
                "gdrive_access_token": "",
            }}
        )
        print(f"⚠️  GDRIVE: Cleared expired tokens for {owner_id} — user must reconnect")
        raise


def _download_doc_bytes(doc, owner_id):
    if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
        file_id = doc.get("gdrive_file_id")
        if not file_id:
            raise ValueError("Missing gdrive_file_id")
        service = _get_gdrive_service(owner_id)
        return gdrive_engine.download_file_bytes(service, file_id)

    firebase_path = doc.get("firebase_path")
    if not firebase_path:
        raise ValueError("Missing firebase_path")
    return _download_smart(firebase_path, owner_id)


def _delete_doc_storage(doc, owner_id, gdrive_service=None):
    if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
        file_id = doc.get("gdrive_file_id")
        if not file_id:
            raise ValueError("Missing gdrive_file_id")
        service = gdrive_service or _get_gdrive_service(owner_id)
        gdrive_engine.delete_file(service, file_id)
        return "gdrive"

    firebase_path = doc.get("firebase_path")
    if not firebase_path:
        raise ValueError("Missing firebase_path")
    storage_engine.delete_file(firebase_path)
    return "firebase"


def _build_gdrive_filename(doc_type, doc_id, ext=".webp"):
    """Build a GDrive-friendly filename from doc_type and doc_id."""
    type_part = (doc_type or "Document").strip().replace(" ", "_")
    safe_type = "".join(ch for ch in type_part if ch.isalnum() or ch in ("_", "-"))
    short_id = (doc_id or "").split("-")[0]
    date_tag = datetime.datetime.utcnow().strftime("%Y%m%d")
    return f"{safe_type}_{date_tag}_{short_id}{ext}"


def _store_final_artifact(
    owner_id, doc_id, raw_bytes, client_name, doc_type,
    old_doc, gdrive_service=None
):
    """
    Create a compressed WebP artifact, upload to the correct location,
    and delete the old inbox raw copy.
    
    Returns dict with:
      - storage_backend: "gdrive" or "firebase"
      - gdrive_file_id: (GDrive only) new file ID
      - firebase_path: (Firebase only) new blob path
      - stored_size: size of the compressed artifact
      - compressed_hash: SHA-256 of compressed artifact
      - content_hash: SHA-256 of original raw bytes (preserved)
      - storage_filename: human-readable filename used
    """
    # 1. Compress the original bytes for storage
    compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, filename=client_name or doc_type, quality_override=82)
    stored_size = len(compressed_bytes)
    compressed_hash = hashlib.sha256(compressed_bytes).hexdigest()
    content_hash = hashlib.sha256(raw_bytes).hexdigest()

    # 2. Determine the user's storage preference
    user_profile = db.users.find_one({"uid": owner_id})
    use_gdrive = user_profile and user_profile.get("storage_mode") == "gdrive"

    if use_gdrive:
        # Upload to GDrive: Vaultify/<ClientName>/<DocType>/
        if not gdrive_service:
            gdrive_service = _get_gdrive_service(owner_id)
        
        client_name_stub = (client_name or "Unsorted").replace(" ", "_").upper()
        doc_type_stub = (doc_type or "Unsorted").replace(" ", "_").upper()
        
        folder_id = gdrive_engine.create_folder_hierarchy(gdrive_service, client_name_stub, doc_type_stub)
        gdrive_filename = _build_gdrive_filename(doc_type, doc_id, ext=".webp")
        
        file_obj = gdrive_engine.upload_file(gdrive_service, compressed_bytes, gdrive_filename, folder_id)
        new_gdrive_file_id = file_obj.get("id")
        
        # Delete old inbox file (if different from new)
        if old_doc.get("gdrive_file_id") and old_doc.get("gdrive_file_id") != new_gdrive_file_id:
            try:
                gdrive_engine.delete_file(gdrive_service, old_doc["gdrive_file_id"])
            except Exception as e:
                print(f"    ⚠️ Failed to delete old inbox from GDrive: {e}")
        
        return {
            "storage_backend": "gdrive",
            "gdrive_file_id": new_gdrive_file_id,
            "firebase_path": None,
            "stored_size": stored_size,
            "compressed_hash": compressed_hash,
            "content_hash": content_hash,
            "storage_filename": gdrive_filename,
            "_gdrive_service": gdrive_service,
        }
    else:
        # Upload to Firebase
        dek = kms_engine.get_or_create_dek(owner_id, db)
        new_firebase_path, stored_size = storage_engine.upload_encrypted(compressed_bytes, owner_id, doc_id, dek)
        
        # Delete old inbox Firebase file (if different from new)
        if old_doc.get("firebase_path") and old_doc.get("firebase_path") != new_firebase_path:
            try:
                storage_engine.delete_file(old_doc["firebase_path"])
            except Exception as e:
                print(f"    ⚠️ Failed to delete old inbox from Firebase: {e}")
        
        return {
            "storage_backend": "firebase",
            "gdrive_file_id": None,
            "firebase_path": new_firebase_path,
            "stored_size": stored_size,
            "compressed_hash": compressed_hash,
            "content_hash": content_hash,
            "storage_filename": f"{doc_id}.webp",
        }