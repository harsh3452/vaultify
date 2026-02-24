import os
import functools
from flask import Blueprint, request, jsonify
from firebase_admin import auth as firebase_auth
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

auth_bp = Blueprint('auth', __name__)

# MongoDB — used by app_secure.py for client/document data
MONGO_URI = os.getenv("MONGO_URI")
client    = MongoClient(MONGO_URI)
db        = client.vaultify_db


# ------------------------------------------------------------------ #
#  FIREBASE TOKEN VERIFICATION DECORATOR                              #
# ------------------------------------------------------------------ #
def firebase_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        # Accept token from Authorization header OR ?token= query param
        # (query param needed for <img src> tags that can't set headers)
        id_token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            id_token = auth_header.split('Bearer ')[1].strip()
        else:
            id_token = request.args.get('token', '').strip()

        if not id_token:
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401

        try:
            # clock_skew_seconds tolerates small differences between
            # the server clock and Google's clock (very common on Windows)
            decoded = firebase_auth.verify_id_token(id_token, clock_skew_seconds=5)

            # Block access until email is verified via magic link
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
    return jsonify({
        'uid':   request.firebase_uid,
        'email': request.firebase_email,
        'name':  request.firebase_name,
    }), 200


# ------------------------------------------------------------------ #
#  /auth/forgot-password                                              #
#  Frontend can call Firebase sendPasswordResetEmail() directly —    #
#  this endpoint exists only if you want server-side rate limiting   #
#  or logging later.                                                  #
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

    # Always same response — prevent email enumeration
    return jsonify({'message': 'If that email exists, a reset link has been sent.'}), 200