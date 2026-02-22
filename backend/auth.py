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
    """
    Drop-in replacement for @jwt_required().
    Reads the Firebase ID token from the Authorization header,
    verifies it, and sets request.firebase_uid + request.firebase_email.
    """
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401

        id_token = auth_header.split('Bearer ')[1].strip()
        try:
            decoded = firebase_auth.verify_id_token(id_token)
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
    """Helper — returns the verified Firebase UID for the current request."""
    return request.firebase_uid


# ------------------------------------------------------------------ #
#  OPTIONAL: /auth/me — returns current user info                     #
# ------------------------------------------------------------------ #
@auth_bp.route('/me', methods=['GET'])
@firebase_required
def get_current_user():
    return jsonify({
        'uid':   request.firebase_uid,
        'email': request.firebase_email,
        'name':  request.firebase_name,
    }), 200
