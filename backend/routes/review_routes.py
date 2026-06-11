import datetime
from flask import Blueprint, jsonify, request
from auth import firebase_required, db
from services.pii_crypto import decrypt_client_pii

review_bp = Blueprint("review_bp", __name__)


def _load_helpers():
    # Import services first to avoid circular imports
    from services.storage_service import _download_doc_bytes
    from services.client_service import (
        TYPE_MAP,
        find_or_create_client,
        _cleanup_empty_client,
        _update_client_fields,
    )
    from services.activity_service import log_activity
    from ai_engine import current_brain, gemini_brain, id_classifier

    return {
        "_download_doc_bytes": _download_doc_bytes,
        "TYPE_MAP": TYPE_MAP,
        "find_or_create_client": find_or_create_client,
        "_cleanup_empty_client": _cleanup_empty_client,
        "_update_client_fields": _update_client_fields,
        "log_activity": log_activity,
        "current_brain": current_brain,
        "gemini_brain": gemini_brain,
        "id_classifier": id_classifier,
    }


@review_bp.route('/review', methods=['GET'])
@firebase_required
def get_review():
    owner_id = request.firebase_uid

    # Clients already flagged for review
    review_clients = list(db.clients.find(
        {"owner_id": owner_id, "needs_review": True},
        {"_id": 0, "owner_id": 0}
    ))

    # Also always include UNKNOWN_CLIENT-named clients (they are always in review)
    from services.client_service import UNKNOWN_CLIENT_NAMES
    unknown_clients = list(db.clients.find(
        {"owner_id": owner_id,
         "name": {"$in": list(UNKNOWN_CLIENT_NAMES - {""})}},
        {"_id": 0, "owner_id": 0}
    ))

    # Merge unknowns into review list (de-duplicate by name)
    seen_names = {c["name"] for c in review_clients}
    for c in unknown_clients:
        if c["name"] not in seen_names:
            review_clients.append(c)

    # Decrypt PII fields and strip soft-deleted docs from each client
    decrypted = []
    for c in review_clients:
        c["documents"] = [d for d in c.get("documents", []) if not d.get("deleted_at")]
        if not c["documents"]:
            continue
        decrypted.append(decrypt_client_pii(owner_id, c))

    return jsonify({"total": len(decrypted), "clients": decrypted}), 200


@review_bp.route('/review/confirm', methods=['POST'])
@firebase_required
def confirm_review():
    owner_id = request.firebase_uid
    doc_id = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    from services.client_service import UNKNOWN_CLIENT_NAMES
    if (client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES:
        return jsonify({"error": "UNKNOWN_CLIENT documents cannot be confirmed — please reassign or edit them first"}), 400

    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.needs_review": False}}
    )
    updated = db.clients.find_one({"_id": client["_id"]})
    if not any(d.get("needs_review") for d in updated.get("documents", [])):
        db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({"message": "Confirmed", "doc_id": doc_id}), 200


@review_bp.route('/review/reanalyze', methods=['POST'])
@firebase_required
def reanalyze_doc():
    owner_id = request.firebase_uid
    doc_id = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    if not doc:
        return jsonify({"error": "Document entry missing"}), 404

    # Mark as queued and enqueue background AI analysis
    try:
        from tasks.reanalyze_tasks import reanalyze_document
        reanalyze_document(owner_id, doc_id)
        db.clients.update_one(
            {"_id": client["_id"], "documents.doc_id": doc_id},
            {
                "$set": {
                    "documents.$.status": "queued",
                    "documents.$.queued_at": datetime.datetime.now(),
                },
            },
        )

        return jsonify({
            "message": "Reanalyze queued",
            "doc_id": doc_id,
        }), 202
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@review_bp.route('/review/update', methods=['PATCH'])
@firebase_required
def update_review():
    helpers = _load_helpers()
    _update_client_fields = helpers["_update_client_fields"]

    owner_id = request.firebase_uid
    data = request.json
    doc_id = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    _update_client_fields(client["_id"], data)
    db.clients.update_one({"_id": client["_id"], "documents.doc_id": doc_id}, {"$set": {"documents.$.needs_review": False}})
    updated = db.clients.find_one({"_id": client["_id"]})
    if not any(d.get("needs_review") for d in updated.get("documents", [])):
        db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({"message": "Updated", "doc_id": doc_id}), 200
