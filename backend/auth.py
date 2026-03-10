import os
import functools
import datetime
from bson import ObjectId
from flask import Blueprint, request, jsonify
from firebase_admin import auth as firebase_auth
from pymongo import MongoClient
from dotenv import load_dotenv
from email_service import send_share_notification, send_share_revoked_notification

load_dotenv()

auth_bp = Blueprint('auth', __name__)

# MongoDB
MONGO_URI = os.getenv("MONGO_URI")
client    = MongoClient(MONGO_URI)
db        = client.vaultify_db

# Ensure indexes for the shares collection
db.shares.create_index([("owner_id", 1)])
db.shares.create_index([("shared_with_email", 1)])
db.shares.create_index([("shared_with_uid", 1)])


# ------------------------------------------------------------------ #
#  FIREBASE TOKEN VERIFICATION DECORATOR                              #
# ------------------------------------------------------------------ #
def firebase_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        id_token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            id_token = auth_header.split('Bearer ')[1].strip()
        else:
            id_token = request.args.get('token', '').strip()

        if not id_token:
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401

        try:
            decoded = firebase_auth.verify_id_token(id_token, clock_skew_seconds=5)

            if not decoded.get('email_verified', False):
                return jsonify({'error': 'Email not verified. Please check your inbox.'}), 403

            request.firebase_uid   = decoded['uid']
            request.firebase_email = decoded.get('email', '')
            request.firebase_name  = decoded.get('name', '')

        except firebase_auth.ExpiredIdTokenError:
            return jsonify({'error': 'Token expired. Please log in again.'}), 401
        except firebase_auth.InvalidIdTokenError:
            return jsonify({'error': 'Invalid token.'}), 401
        except Exception as e:
            return jsonify({'error': f'Auth failed: {str(e)}'}), 401

        return f(*args, **kwargs)
    return decorated


def get_firebase_uid():
    return request.firebase_uid


# ------------------------------------------------------------------ #
#  /auth/me                                                           #
# ------------------------------------------------------------------ #
@auth_bp.route('/me', methods=['GET'])
@firebase_required
def get_current_user():
    uid   = request.firebase_uid
    email = request.firebase_email

    shared_count = db.shares.count_documents({
        "$or": [{"shared_with_uid": uid}, {"shared_with_email": email.lower()}]
    })

    return jsonify({
        'uid':          uid,
        'email':        email,
        'name':         request.firebase_name,
        'shared_count': shared_count,
    }), 200


# ------------------------------------------------------------------ #
#  SHARE MANAGEMENT                                                   #
# ------------------------------------------------------------------ #

@auth_bp.route('/share', methods=['POST'])
@firebase_required
def create_share():
    """Share a document or client folder with another user by email."""
    owner_id = request.firebase_uid
    data     = request.get_json(silent=True) or {}

    email         = (data.get("email") or "").strip().lower()
    resource_type = (data.get("resource_type") or "").strip().lower()
    resource_id   = (data.get("resource_id") or "").strip()
    permission    = (data.get("permission") or "viewer").strip().lower()

    if not email:
        return jsonify({"error": "Email is required"}), 400
    if resource_type not in ("document", "client"):
        return jsonify({"error": "resource_type must be 'document' or 'client'"}), 400
    if not resource_id:
        return jsonify({"error": "resource_id is required"}), 400
    if permission not in ("viewer", "editor"):
        return jsonify({"error": "permission must be 'viewer' or 'editor'"}), 400
    if email == request.firebase_email.lower():
        return jsonify({"error": "You cannot share with yourself"}), 400

    # Verify the resource exists and belongs to the owner
    if resource_type == "document":
        client_rec = db.clients.find_one({
            "owner_id": owner_id,
            "documents.doc_id": resource_id
        })
        if not client_rec:
            return jsonify({"error": "Document not found in your vault"}), 404
        doc = next((d for d in client_rec["documents"] if d["doc_id"] == resource_id), None)
        resource_label = doc.get("filename", resource_id) if doc else resource_id
    else:
        client_rec = db.clients.find_one({
            "owner_id": owner_id,
            "name": resource_id
        })
        if not client_rec:
            return jsonify({"error": "Client folder not found in your vault"}), 404
        resource_label = resource_id

    existing = db.shares.find_one({
        "owner_id":          owner_id,
        "shared_with_email": email,
        "resource_type":     resource_type,
        "resource_id":       resource_id,
    })
    if existing:
        return jsonify({"error": "Already shared with this user"}), 409

    shared_with_uid = None
    try:
        recipient = firebase_auth.get_user_by_email(email)
        shared_with_uid = recipient.uid
    except Exception:
        pass

    share_doc = {
        "owner_id":          owner_id,
        "owner_email":       request.firebase_email,
        "owner_name":        request.firebase_name or request.firebase_email,
        "shared_with_email": email,
        "shared_with_uid":   shared_with_uid,
        "resource_type":     resource_type,
        "resource_id":       resource_id,
        "resource_label":    resource_label,
        "permission":        permission,
        "created_at":        datetime.datetime.now(),
    }
    result = db.shares.insert_one(share_doc)

    send_share_notification(
        to_email=email,
        sharer_name=request.firebase_name or request.firebase_email,
        resource_name=resource_label,
        resource_type=resource_type,
        permission=permission,
    )

    return jsonify({
        "message":  f"Shared with {email}",
        "share_id": str(result.inserted_id),
    }), 201


@auth_bp.route('/shares', methods=['GET'])
@firebase_required
def list_my_shares():
    """List resources I have shared with others (outgoing)."""
    owner_id = request.firebase_uid
    shares   = list(db.shares.find({"owner_id": owner_id}))

    out = []
    for s in shares:
        out.append({
            "share_id":          str(s["_id"]),
            "shared_with_email": s["shared_with_email"],
            "resource_type":     s["resource_type"],
            "resource_id":       s["resource_id"],
            "resource_label":    s.get("resource_label", s["resource_id"]),
            "permission":        s["permission"],
            "created_at":        s["created_at"].strftime("%Y-%m-%d %H:%M:%S")
                                 if hasattr(s.get("created_at"), "strftime") else "",
        })

    return jsonify({"shares": out}), 200


@auth_bp.route('/shares/for-resource', methods=['GET'])
@firebase_required
def shares_for_resource():
    """List all shares for a specific resource (used by ShareDialog)."""
    owner_id      = request.firebase_uid
    resource_type = request.args.get("resource_type", "").strip().lower()
    resource_id   = request.args.get("resource_id", "").strip()

    if not resource_type or not resource_id:
        return jsonify({"error": "resource_type and resource_id required"}), 400

    shares = list(db.shares.find({
        "owner_id":      owner_id,
        "resource_type": resource_type,
        "resource_id":   resource_id,
    }))

    out = []
    for s in shares:
        out.append({
            "share_id":          str(s["_id"]),
            "shared_with_email": s["shared_with_email"],
            "permission":        s["permission"],
            "created_at":        s["created_at"].strftime("%Y-%m-%d %H:%M:%S")
                                 if hasattr(s.get("created_at"), "strftime") else "",
        })

    return jsonify({"shares": out}), 200


@auth_bp.route('/shared-with-me', methods=['GET'])
@firebase_required
def shared_with_me():
    """List resources shared with me, grouped by owner."""
    uid   = request.firebase_uid
    email = request.firebase_email.lower()

    # Backfill uid for shares created before user registered
    db.shares.update_many(
        {"shared_with_email": email, "shared_with_uid": None},
        {"$set": {"shared_with_uid": uid}}
    )

    shares = list(db.shares.find({
        "$or": [{"shared_with_uid": uid}, {"shared_with_email": email}]
    }))

    items = []
    for s in shares:
        owner_id = s["owner_id"]

        item = {
            "share_id":       str(s["_id"]),
            "owner_id":       owner_id,
            "owner_name":     s.get("owner_name", ""),
            "owner_email":    s.get("owner_email", ""),
            "resource_type":  s["resource_type"],
            "resource_id":    s["resource_id"],
            "resource_label": s.get("resource_label", s["resource_id"]),
            "permission":     s["permission"],
            "created_at":     s["created_at"].strftime("%Y-%m-%d %H:%M:%S")
                              if hasattr(s.get("created_at"), "strftime") else "",
        }

        if s["resource_type"] == "client":
            client_rec = db.clients.find_one({"owner_id": owner_id, "name": s["resource_id"]})
            if client_rec:
                docs = [d for d in client_rec.get("documents", []) if not d.get("deleted_at")]
                item["doc_count"] = len(docs)
                if docs:
                    item["preview_path"] = docs[0].get("firebase_path", "")
            else:
                item["doc_count"] = 0
        else:
            client_rec = db.clients.find_one({
                "owner_id": owner_id,
                "documents.doc_id": s["resource_id"]
            })
            if client_rec:
                doc = next((d for d in client_rec["documents"] if d["doc_id"] == s["resource_id"]), None)
                if doc:
                    item["firebase_path"] = doc.get("firebase_path", "")
                    item["doc_type"]      = doc.get("type", "")
                    item["filename"]      = doc.get("filename", "")
                    item["file_size"]     = doc.get("file_size", 0)
                    item["client_name"]   = client_rec.get("name", "")

        items.append(item)

    return jsonify({"items": items}), 200


@auth_bp.route('/share/<share_id>', methods=['DELETE'])
@firebase_required
def revoke_share(share_id):
    """Revoke (delete) a share. Only the owner can revoke."""
    try:
        oid = ObjectId(share_id)
    except Exception:
        return jsonify({"error": "Invalid share_id"}), 400

    share = db.shares.find_one({"_id": oid, "owner_id": request.firebase_uid})
    if not share:
        return jsonify({"error": "Share not found or not yours"}), 404

    db.shares.delete_one({"_id": oid})

    send_share_revoked_notification(
        to_email=share["shared_with_email"],
        revoker_name=request.firebase_name or request.firebase_email,
        resource_name=share.get("resource_label", share["resource_id"]),
        resource_type=share["resource_type"],
    )

    return jsonify({"message": "Share revoked"}), 200


@auth_bp.route('/share/<share_id>', methods=['PATCH'])
@firebase_required
def update_share_permission(share_id):
    """Update the permission level of a share."""
    try:
        oid = ObjectId(share_id)
    except Exception:
        return jsonify({"error": "Invalid share_id"}), 400

    data       = request.get_json(silent=True) or {}
    permission = (data.get("permission") or "").strip().lower()
    if permission not in ("viewer", "editor"):
        return jsonify({"error": "permission must be 'viewer' or 'editor'"}), 400

    result = db.shares.update_one(
        {"_id": oid, "owner_id": request.firebase_uid},
        {"$set": {"permission": permission}}
    )
    if result.matched_count == 0:
        return jsonify({"error": "Share not found or not yours"}), 404

    return jsonify({"message": f"Permission updated to {permission}"}), 200


# ------------------------------------------------------------------ #
#  /auth/forgot-password                                              #
# ------------------------------------------------------------------ #
@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data  = request.get_json(silent=True) or {}
    email = data.get('email', '').strip()
    if not email:
        return jsonify({'error': 'Email is required'}), 400

    try:
        firebase_auth.generate_password_reset_link(email)
    except Exception:
        pass

    return jsonify({'message': 'If that email exists, a reset link has been sent.'}), 200
