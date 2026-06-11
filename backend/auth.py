import os
import functools
import datetime
import base64
from bson import ObjectId
from flask import Blueprint, request, jsonify
from firebase_admin import auth as firebase_auth
from pymongo import MongoClient
from dotenv import load_dotenv
from email_service import send_share_notification, send_share_revoked_notification
import urllib.parse
import requests
from kms_manager import kms_engine

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


def _encrypt_token(owner_id, token):
    if not token:
        return None
    dek = kms_engine.get_or_create_dek(owner_id, db)
    encrypted = kms_engine.encrypt_bytes(dek, token.encode("utf-8"))
    return base64.urlsafe_b64encode(encrypted).decode("ascii")


def _decrypt_token(owner_id, token_enc):
    if not token_enc:
        return None
    try:
        dek = kms_engine.get_or_create_dek(owner_id, db)
        encrypted = base64.urlsafe_b64decode(token_enc.encode("ascii"))
        decrypted = kms_engine.decrypt_bytes(dek, encrypted)
        return decrypted.decode("utf-8")
    except Exception:
        return None


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

    # Get user's storage mode and Google Drive status
    user_profile = db.users.find_one({"uid": uid})
    storage_mode = user_profile.get("storage_mode", "firebase") if user_profile else "firebase"
    has_gdrive = bool(
        user_profile and (
            user_profile.get("gdrive_refresh_token_enc") or
            user_profile.get("gdrive_access_token_enc")
        )
    )

    return jsonify({
        'uid':           uid,
        'email':         email,
        'name':          request.firebase_name,
        'shared_count':  shared_count,
        'storage_mode':  storage_mode,
        'has_gdrive':    has_gdrive,
    }), 200


@auth_bp.route('/storage-mode', methods=['POST'])
@firebase_required
def update_storage_mode():
    """Update user's preferred storage backend."""
    uid = request.firebase_uid
    data = request.get_json(silent=True) or {}
    mode = (data.get("storage_mode") or "").strip().lower()

    if mode not in ("firebase", "gdrive"):
        return jsonify({"error": "storage_mode must be 'firebase' or 'gdrive'"}), 400

    if mode == "gdrive":
        profile = db.users.find_one({"uid": uid}) or {}
        has_token = bool(profile.get("gdrive_refresh_token_enc") or profile.get("gdrive_access_token_enc"))
        if not has_token:
            return jsonify({"error": "Google Drive is not connected for this user"}), 400

    db.users.update_one(
        {"uid": uid},
        {"$set": {"storage_mode": mode, "storage_mode_updated_at": datetime.datetime.now()}},
        upsert=True
    )

    return jsonify({"message": "Storage mode updated", "storage_mode": mode}), 200


# ------------------------------------------------------------------ #
#  GOOGLE DRIVE TOKEN MANAGEMENT                                      #
# ------------------------------------------------------------------ #
@auth_bp.route('/save-gdrive-token', methods=['POST'])
@firebase_required
def save_gdrive_token():
    """Save Google Drive access token (short-lived, from client-side Google Login).
    
    This is used when the user signs in with Google via Firebase Auth.
    The access_token alone is short-lived (~1hr). For a long-lived refresh_token,
    use the /gdrive-auth-url + /gdrive-callback OAuth flow instead.
    """
    uid   = request.firebase_uid
    data  = request.get_json(silent=True) or {}
    
    access_token = (data.get("access_token") or "").strip()
    
    if not access_token:
        return jsonify({"error": "access_token is required"}), 400  
    
    # Ensure users collection has an index
    db.users.create_index([("uid", 1)], unique=True)
    
    # Save access token only (NOT as a refresh token — that would break later)
    access_token_enc = _encrypt_token(uid, access_token)
    
    # Check if user already has a valid refresh token — if so, keep it
    existing = db.users.find_one({"uid": uid})
    existing_refresh = existing.get("gdrive_refresh_token_enc") if existing else None
    
    update = {
        "$set": {
            "uid": uid,
            "email": request.firebase_email,
            "name": request.firebase_name,
            "gdrive_access_token_enc": access_token_enc,
            "storage_mode": "gdrive",
            "gdrive_enabled_at": datetime.datetime.now() if not existing_refresh else existing.get("gdrive_enabled_at"),
            "gdrive_token_updated_at": datetime.datetime.now(),
        },
        "$unset": {
            "gdrive_access_token": "",
            "gdrive_refresh_token": "",
        }
    }
    
    # Only overwrite refresh_token if we don't have one (access_token can't be used as refresh)
    if not existing_refresh:
        update["$unset"]["gdrive_refresh_token_enc"] = ""
    
    db.users.update_one({"uid": uid}, update, upsert=True)
    
    print(f"✅ AUTH: Google Drive access token saved for {request.firebase_email}")
    return jsonify({
        "message": "Google Drive access token saved",
        "storage_mode": "gdrive",
        "has_refresh_token": bool(existing_refresh),
    }), 200


# ------------------------------------------------------------------ #
#  SERVER-SIDE OAUTH FLOW FOR REAL REFRESH TOKEN                      #
# ------------------------------------------------------------------ #
@auth_bp.route('/gdrive-auth-url', methods=['GET'])
@firebase_required
def gdrive_auth_url():
    """Return a Google OAuth consent URL for the current user (state=uid)."""
    uid = request.firebase_uid
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    redirect_uri = os.getenv('GDRIVE_OAUTH_REDIRECT') or (request.host_url.rstrip('/') + '/auth/gdrive-callback')
    scope = 'https://www.googleapis.com/auth/drive.file'
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': scope,
        'access_type': 'offline',
        'prompt': 'consent',
        'state': uid,
    }
    url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params)
    return jsonify({'url': url}), 200


@auth_bp.route('/gdrive-callback', methods=['GET'])
def gdrive_callback():
    """OAuth callback: exchange code for tokens and save refresh_token to DB.

    Expects query params: code, state
    """
    code = request.args.get('code')
    state = request.args.get('state')  # this is the firebase uid we set earlier
    error = request.args.get('error')
    if error:
        return f"OAuth error: {error}", 400
    if not code or not state:
        return "Missing code or state", 400

    token_endpoint = 'https://oauth2.googleapis.com/token'
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    redirect_uri = os.getenv('GDRIVE_OAUTH_REDIRECT') or (request.host_url.rstrip('/') + '/auth/gdrive-callback')

    data = {
        'code': code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }

    try:
        resp = requests.post(token_endpoint, data=data, timeout=10)
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        print(f"❌ AUTH: Token exchange failed: {e}")
        return "Token exchange failed", 500

    refresh_token = token_data.get('refresh_token')
    access_token = token_data.get('access_token')

    if not refresh_token:
        # In some cases refresh_token may not be returned (e.g., already granted).
        # We still save access_token and mark that refresh token is missing.
        print('⚠️  AUTH: No refresh_token returned by Google')

    # Save tokens to user's profile identified by state (uid)
    db.users.create_index([("uid", 1)], unique=True)
    refresh_token_enc = _encrypt_token(state, refresh_token)
    access_token_enc = _encrypt_token(state, access_token)

    db.users.update_one(
        {"uid": state},
        {
            "$set": {
                "gdrive_refresh_token_enc": refresh_token_enc,
                "gdrive_access_token_enc": access_token_enc,
                "storage_mode": "gdrive",
                "gdrive_enabled_at": datetime.datetime.now(),
                "gdrive_token_updated_at": datetime.datetime.now(),
            },
            "$unset": {
                "gdrive_refresh_token": "",
                "gdrive_access_token": "",
            }
        },
        upsert=True
    )

    # Return a small HTML page that notifies the opener window and closes.
    success_html = f"""
    <html>
      <body>
        <script>
          try {{
            window.opener.postMessage({{'type':'gdrive_connected','status':'success','uid':'{state}'}}, '*');
          }} catch(e) {{}}
          document.write('<p>Google Drive connected. You can close this window.</p>');
          setTimeout(() => window.close(), 1500);
        </script>
      </body>
    </html>
    """
    return success_html, 200


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
