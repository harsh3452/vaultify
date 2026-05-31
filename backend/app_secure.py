import os
import uuid
import datetime
import base64
from flask import Flask, jsonify, request, send_file, make_response
from flask_cors import CORS
from dotenv import load_dotenv
from storage_manager import storage_engine
from gdrive_manager import gdrive_engine
from auth import auth_bp, db, firebase_required
from ai_engine import current_brain, gemini_brain, id_classifier
from services.client_service import _update_client_fields
from services.pii_crypto import decrypt_client_pii
from services.storage_service import _download_doc_bytes, _delete_doc_storage
from services.activity_service import log_activity
from routes.upload_routes import upload_bp
from routes.media_routes import media_bp
from routes.review_routes import review_bp
from routes.documents_routes import documents_bp

# Environment + app setup
load_dotenv()
app = Flask(__name__)
CORS(app)


def _serialize_dt(value):
    return value.strftime("%Y-%m-%d %H:%M:%S") if hasattr(value, "strftime") else value


def _serialize_doc(doc):
    serialized = dict(doc)
    for key in ("uploaded_at", "deleted_at", "queued_at", "started_at", "finished_at"):
        if key in serialized:
            serialized[key] = _serialize_dt(serialized[key])
    return serialized


def _serialize_client(client):
    # Decrypt PII fields (pan_number, voter_id_number, dl_number) before returning
    owner_id = client.get("owner_id", "")
    decrypted = decrypt_client_pii(owner_id, client)
    serialized = {k: v for k, v in decrypted.items() if k != "_id"}
    serialized["documents"] = [_serialize_doc(doc) for doc in client.get("documents", [])]
    if "created_at" in serialized:
        serialized["created_at"] = _serialize_dt(serialized["created_at"])
    return serialized
# ------------------------------------------------------------------ #
#  COMPATIBILITY ROUTES FOR THE CURRENT FRONTEND                     #
# ------------------------------------------------------------------ #

@app.route('/clients', methods=['GET'])
@firebase_required
def list_clients():
    owner_id = request.firebase_uid
    clients = list(db.clients.find({"owner_id": owner_id}, {"owner_id": 0}))
    return jsonify({"clients": [_serialize_client(client) for client in clients]}), 200


@app.route('/dashboard', methods=['GET'])
@firebase_required
def dashboard_summary():
    owner_id = request.firebase_uid
    clients = list(db.clients.find({"owner_id": owner_id}, {"owner_id": 0}))
    docs = [doc for client in clients for doc in client.get("documents", []) if not doc.get("deleted_at")]
    by_type = {}
    pending_count = 0
    needs_review = 0
    storage_used_mb = 0.0

    for doc in docs:
        doc_type = doc.get("type") or "Unsorted"
        by_type[doc_type] = by_type.get(doc_type, 0) + 1
        if doc.get("status") in ("queued", "processing", "pending", "failed") or doc.get("needs_review"):
            pending_count += 1
        if doc.get("needs_review"):
            needs_review += 1
        storage_used_mb += float(doc.get("file_size", 0) or 0) / (1024 * 1024)

    return jsonify({
        "storage_used_mb": round(storage_used_mb, 2),
        "needs_review": needs_review,
        "total_files": len(docs),
        "total_clients": len(clients),
        "pending_count": pending_count,
        "by_type": by_type,
    }), 200


@app.route('/activity/recent', methods=['GET'])
@firebase_required
def activity_recent():
    owner_id = request.firebase_uid
    limit = min(int(request.args.get("limit", 50)), 200)
    action = (request.args.get("action") or "").strip()

    query = {"owner_id": owner_id}
    if action:
        query["action"] = action

    recent = list(db.activity.find(query).sort("accessed_at", -1).limit(limit))
    items = []
    for item in recent:
        item = dict(item)
        item.pop("_id", None)
        item["accessed_at"] = _serialize_dt(item.get("accessed_at"))
        items.append(item)
    return jsonify({"recent": items}), 200


@app.route('/search', methods=['GET'])
@firebase_required
def search_vault():
    owner_id = request.firebase_uid
    q = (request.args.get("q") or "").strip().lower()
    if len(q) < 2:
        return jsonify({"results": []}), 200

    clients = list(db.clients.find({"owner_id": owner_id}, {"owner_id": 0}))
    results = []

    for client in clients:
        client_name = (client.get("name") or "").lower()
        if q in client_name:
            results.append({"type": "client", "client": _serialize_client(client)})
            continue

        for doc in client.get("documents", []):
            haystack = " ".join([
                str(doc.get("filename", "")),
                str(doc.get("type", "")),
                str(doc.get("client_name", "")),
            ]).lower()
            if q in haystack:
                results.append({
                    "type": "document",
                    "client": client.get("name", ""),
                    "document": _serialize_doc(doc),
                })

    return jsonify({"results": results}), 200


# ------------------------------------------------------------------ #
#  TASK STATUS — frontend polls this to check Celery job progress     #
# ------------------------------------------------------------------ #

@app.route('/task/<doc_id>/status', methods=['GET'])
@firebase_required
def task_status(doc_id):
    """Return the current status of a document so the frontend can poll."""
    owner_id = request.firebase_uid
    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404

    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    if not doc:
        return jsonify({"error": "Not found"}), 404

    return jsonify({
        "doc_id": doc_id,
        "status": doc.get("status", "unknown"),
        "needs_review": doc.get("needs_review", False),
        "type": doc.get("type", "Unsorted"),
        "client_name": client.get("name", ""),
        "processing_task": doc.get("processing_task"),
        "queued_at": _serialize_dt(doc.get("queued_at")),
        "started_at": _serialize_dt(doc.get("started_at")),
        "finished_at": _serialize_dt(doc.get("finished_at")),
    }), 200


# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/auth')
app.register_blueprint(upload_bp)
app.register_blueprint(media_bp)
app.register_blueprint(review_bp)
app.register_blueprint(documents_bp)


if __name__ == '__main__':
    # Explicit host so it's reachable from other tools if needed
    app.run(debug=True, port=8000, host='127.0.0.1')