import io
import hashlib
from flask import Blueprint, jsonify, request, send_file, make_response
from PIL import Image
from auth import db, firebase_required

media_bp = Blueprint("media_bp", __name__)


def _load_helpers():
    from services.storage_service import (
        _download_doc_bytes,
        _delete_doc_storage,
        _get_gdrive_service,
    )
    from services.activity_service import log_activity

    return {
        "_download_doc_bytes": _download_doc_bytes,
        "_delete_doc_storage": _delete_doc_storage,
        "_get_gdrive_service": _get_gdrive_service,
        "log_activity": log_activity,
    }


@media_bp.route('/preview', methods=['GET'])
@firebase_required
def preview_file():
    helpers = _load_helpers()
    _download_doc_bytes = helpers["_download_doc_bytes"]
    log_activity = helpers["log_activity"]

    owner_id = request.firebase_uid
    firebase_path = request.args.get('path')
    doc_id = request.args.get('doc_id')
    if not firebase_path and not doc_id:
        return jsonify({"error": "Missing path or doc_id"}), 400
    if firebase_path and not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    if doc_id:
        client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    else:
        client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    if not doc:
        return jsonify({"error": "File not found"}), 404
    try:
        file_bytes = _download_doc_bytes(doc, owner_id)
        activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
        extra = None
        if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
            extra = {
                "storage_backend": "gdrive",
                "gdrive_file_id": doc.get("gdrive_file_id")
            }
        log_activity(owner_id, doc["doc_id"], client["_id"], activity_path, doc["filename"], doc["type"], "preview", client_name=client.get("name", ""), extra=extra)

        # Re-encode to JPG for consistent browser previews
        try:
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=85)
            buf.seek(0)
            out_bytes = buf.getvalue()
            mime = "image/jpeg"
        except Exception:
            # Fallback to raw bytes if PIL decode fails
            out_bytes = file_bytes
            mime = "image/webp"

        # Build ETag from preview bytes for browser-level caching
        etag = hashlib.md5(out_bytes).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip('" ')
        if if_none_match == etag:
            return "", 304

        response = make_response(send_file(io.BytesIO(out_bytes), mimetype=mime, as_attachment=False))
        response.headers["Cache-Control"] = "private, max-age=86400"
        response.headers["ETag"] = f'"{etag}"'
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@media_bp.route('/download', methods=['GET'])
@firebase_required
def download_file():
    helpers = _load_helpers()
    _download_doc_bytes = helpers["_download_doc_bytes"]
    log_activity = helpers["log_activity"]

    owner_id = request.firebase_uid
    firebase_path = request.args.get('path')
    doc_id = request.args.get('doc_id')
    out_format = request.args.get('format', 'jpg').lower()

    if not firebase_path and not doc_id:
        return jsonify({"error": "Missing path or doc_id"}), 400
    if firebase_path and not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    if doc_id:
        client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    else:
        client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    if not doc:
        return jsonify({"error": "File not found"}), 404
    rotation = int(request.args.get('rotation', 0)) % 360
    try:
        file_bytes = _download_doc_bytes(doc, owner_id)
        dl_name = f"{client['name']}_{doc['type']}"
        activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
        extra = None
        if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
            extra = {
                "storage_backend": "gdrive",
                "gdrive_file_id": doc.get("gdrive_file_id")
            }
        log_activity(owner_id, doc["doc_id"], client["_id"], activity_path, doc["filename"], doc["type"], "download", client_name=client.get("name", ""), extra=extra)

        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        if rotation:
            img = img.rotate(-rotation, expand=True)

        if out_format == 'jpg':
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=95)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg', as_attachment=True, download_name=f"{dl_name}.jpg")
        elif out_format == 'pdf':
            if not rotation:
                try:
                    import img2pdf
                    raw = _download_doc_bytes(doc, owner_id)
                    buf = io.BytesIO(img2pdf.convert(raw))
                    return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{dl_name}.pdf")
                except Exception:
                    pass
            buf = io.BytesIO()
            img.save(buf, 'PDF')
            buf.seek(0)
            return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{dl_name}.pdf")
        else:
            return jsonify({"error": "Use jpg or pdf"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@media_bp.route('/delete', methods=['DELETE'])
@firebase_required
def delete_file():
    helpers = _load_helpers()
    _delete_doc_storage = helpers["_delete_doc_storage"]
    log_activity = helpers["log_activity"]

    owner_id = request.firebase_uid
    firebase_path = request.args.get('path')
    doc_id = request.args.get('doc_id')

    if not firebase_path and not doc_id:
        return jsonify({"error": "Missing path or doc_id"}), 400
    if firebase_path and not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    if doc_id:
        client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    else:
        client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
        if not client:
            return jsonify({"error": "File not found"}), 404
        doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    if not doc:
        return jsonify({"error": "File not found"}), 404
    try:
        _delete_doc_storage(doc, owner_id)
        db.clients.update_one(
            {"_id": client["_id"]},
            {"$pull": {"documents": {"doc_id": doc.get("doc_id")}}}
        )
        if doc:
            activity_path = doc.get("firebase_path") or f"gdrive:{doc.get('gdrive_file_id', '')}"
            extra = None
            if doc.get("storage_backend") == "gdrive" or doc.get("gdrive_file_id"):
                extra = {
                    "storage_backend": "gdrive",
                    "gdrive_file_id": doc.get("gdrive_file_id")
                }
            log_activity(owner_id, doc.get("doc_id", ""), client["_id"], activity_path,
                         doc.get("filename", ""), doc.get("type", ""), "delete",
                         client_name=client.get("name", ""), extra=extra)
        updated = db.clients.find_one({"_id": client["_id"]})
        if updated and len(updated.get("documents", [])) == 0:
            db.clients.delete_one({"_id": client["_id"]})
        return jsonify({"message": "Deleted", "doc_id": doc.get("doc_id")} ), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
