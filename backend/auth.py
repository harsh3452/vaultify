import os
import random
import requests
import functools
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, timezone
import firebase_init          # ensures firebase_admin.initialize_app() runs first
from firebase_admin import auth as firebase_auth, firestore
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv

load_dotenv()

auth_bp = Blueprint('auth', __name__)

# ------------------------------------------------------------------ #
#  CORS — apply to every /auth/* response, including error responses  #
# ------------------------------------------------------------------ #
@auth_bp.after_request
def auth_cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    return response

# Firestore client — lazy init so a Firestore error doesn't crash the server at startup
_db = None
def get_db():
    global _db
    if _db is None:
        try:
            _db = firestore.client()
        except Exception as e:
            raise RuntimeError(
                f"Firestore unavailable: {e}\n"
                "➡  Enable Firestore at https://console.firebase.google.com → "
                "Firestore Database → Create database"
            )
    return _db

# Keep 'db' as an alias so app_secure.py import still works
# (app_secure.py uses get_db() internally via its own calls)
db = None  # will be set lazily; app_secure.py uses get_db() directly



# ------------------------------------------------------------------ #
#  FIREBASE TOKEN VERIFICATION DECORATOR                              #
# ------------------------------------------------------------------ #
def firebase_required(f):
    """
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
#  OTP — SEND                                                         #
# ------------------------------------------------------------------ #
@auth_bp.route('/send-otp', methods=['POST'])
def send_otp():
    """
    Body: { "email": "user@example.com" }
    1️⃣  Generate OTP
    2️⃣  Store in Firestore (otp_store/{email}, expires in 10 min)
    3️⃣  Send via Resend email API
    """
    data  = request.get_json(force=True)
    email = (data or {}).get('email', '').strip().lower()

    if not email:
        return jsonify({'error': 'Email is required.'}), 400

    # 1️⃣  Generate
    otp    = str(random.randint(100000, 999999))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=10)

    # 2️⃣  Store in Firestore — document ID = sanitised email
    doc_id = email.replace('@', '_at_').replace('.', '_')
    try:
        get_db().collection('otp_store').document(doc_id).set({
            'email':      email,
            'otp':        otp,
            'expires_at': expiry,
            'used':       False,
        })
    except Exception as e:
        print(f"[FIRESTORE ERROR] {e}")
        return jsonify({
            'error': 'Database unavailable. Make sure Firestore is enabled in your Firebase project.',
            'detail': str(e)
        }), 503

    # 3️⃣  Send via SMTP
    smtp_host     = os.getenv('SMTP_HOST', 'smtp.gmail.com')
    smtp_port     = int(os.getenv('SMTP_PORT', '587'))
    smtp_user     = os.getenv('SMTP_USER')
    smtp_password = os.getenv('SMTP_PASSWORD')
    smtp_from     = os.getenv('SMTP_FROM', smtp_user)

    if not smtp_user or not smtp_password:
        print(f"\n[DEV OTP]  {email}  →  {otp}  (expires in 10 min)\n")
        return jsonify({'message': 'OTP generated (check server console — SMTP credentials not configured).'}), 200

    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;background:#020d1a;padding:48px 40px;
                border-radius:16px;max-width:480px;margin:auto;border:1px solid rgba(0,230,200,0.12)">
      <h2 style="color:#00e6c8;letter-spacing:3px;margin:0 0 6px">VAULTIFY</h2>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 28px">AI-Powered KYC Document Vault</p>
      <p style="color:#cbd5e1;font-size:14px;margin:0 0 20px">Your one-time email verification code is:</p>
      <div style="background:#0a1f35;border:1px solid rgba(0,230,200,0.2);border-radius:14px;
                  padding:28px;text-align:center;margin:0 0 28px">
        <span style="font-size:44px;font-weight:900;letter-spacing:14px;color:#00e6c8;
                     font-family:monospace">{otp}</span>
      </div>
      <p style="color:#6b7280;font-size:12px;line-height:1.7;margin:0">
        This code expires in <strong style="color:#d1faf5">10 minutes</strong>.<br/>
        If you didn't create a Vaultify account, you can safely ignore this email.
      </p>
    </div>
    """

    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Your Vaultify Verification Code'
        msg['From'] = smtp_from
        msg['To'] = email

        # Attach HTML content
        html_part = MIMEText(html, 'html')
        msg.attach(html_part)

        # Send email via SMTP
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)

        return jsonify({'message': 'OTP sent successfully.'}), 200

    except smtplib.SMTPException as e:
        print(f"\n[SMTP ERROR — DEV FALLBACK OTP]  {email}  →  {otp}\n  Error: {e}\n")
        return jsonify({'message': 'OTP generated. Check the server console for the code.'}), 200
    except Exception as e:
        print(f"\n[EMAIL ERROR — DEV FALLBACK OTP]  {email}  →  {otp}\n  Error: {e}\n")
        return jsonify({'message': 'OTP generated. Check the server console for the code.'}), 200


    # ------------------------------------------------------------------ #
    # RESEND API CODE (COMMENTED OUT FOR FUTURE USE)                     #
    # ------------------------------------------------------------------ #
    # resend_api_key = os.getenv('RESEND_API_KEY')
    # resend_from    = os.getenv('RESEND_FROM', 'Vaultify <onboarding@resend.dev>')
    #
    # if not resend_api_key:
    #     print(f"\n[DEV OTP]  {email}  →  {otp}  (expires in 10 min)\n")
    #     return jsonify({'message': 'OTP generated (check server console — RESEND_API_KEY not configured).'}), 200
    #
    # html = f"""
    # <div style="font-family:Inter,Arial,sans-serif;background:#020d1a;padding:48px 40px;
    #             border-radius:16px;max-width:480px;margin:auto;border:1px solid rgba(0,230,200,0.12)">
    #   <h2 style="color:#00e6c8;letter-spacing:3px;margin:0 0 6px">VAULTIFY</h2>
    #   <p style="color:#9ca3af;font-size:13px;margin:0 0 28px">AI-Powered KYC Document Vault</p>
    #   <p style="color:#cbd5e1;font-size:14px;margin:0 0 20px">Your one-time email verification code is:</p>
    #   <div style="background:#0a1f35;border:1px solid rgba(0,230,200,0.2);border-radius:14px;
    #               padding:28px;text-align:center;margin:0 0 28px">
    #     <span style="font-size:44px;font-weight:900;letter-spacing:14px;color:#00e6c8;
    #                  font-family:monospace">{otp}</span>
    #   </div>
    #   <p style="color:#6b7280;font-size:12px;line-height:1.7;margin:0">
    #     This code expires in <strong style="color:#d1faf5">10 minutes</strong>.<br/>
    #     If you didn't create a Vaultify account, you can safely ignore this email.
    #   </p>
    # </div>
    # """
    #
    # try:
    #     resp = requests.post(
    #         'https://api.resend.com/emails',
    #         headers={
    #             'Authorization': f'Bearer {resend_api_key}',
    #             'Content-Type':  'application/json',
    #         },
    #         json={
    #             'from':    resend_from,
    #             'to':      [email],
    #             'subject': 'Your Vaultify Verification Code',
    #             'html':    html,
    #         },
    #         timeout=10
    #     )
    #     if resp.status_code in (200, 201):
    #         return jsonify({'message': 'OTP sent successfully.'}), 200
    #
    #     # Resend rejected — likely unverified domain on free plan.
    #     # Fall back to console so dev testing still works.
    #     resend_err = resp.json() if resp.text else {}
    #     print(f"\n[RESEND REJECTED] {resp.status_code}: {resp.text}")
    #     print(f"[DEV FALLBACK OTP]  {email}  →  {otp}  (expires in 10 min)\n")
    #     return jsonify({
    #         'message': 'OTP generated. Check the server console for the code.',
    #         'dev_note': resend_err.get('message', 'Resend delivery failed — check console for OTP'),
    #     }), 200
    #
    # except requests.exceptions.Timeout:
    #     # Still return 200 with console fallback so flow isn't broken
    #     print(f"\n[RESEND TIMEOUT — DEV FALLBACK OTP]  {email}  →  {otp}\n")
    #     return jsonify({'message': 'OTP generated. Check the server console for the code.'}), 200
    # except requests.exceptions.RequestException as e:
    #     print(f"\n[RESEND ERROR — DEV FALLBACK OTP]  {email}  →  {otp}\n  Error: {e}\n")
    #     return jsonify({'message': 'OTP generated. Check the server console for the code.'}), 200



# ------------------------------------------------------------------ #
#  OTP — VERIFY                                                       #
# ------------------------------------------------------------------ #
@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    """
    Body: { "email": "user@example.com", "otp": "123456" }
    Returns 200 on success, 400/410 on failure.
    """
    data  = request.get_json(force=True)
    email = (data or {}).get('email', '').strip().lower()
    otp   = str((data or {}).get('otp', '')).strip()

    if not email or not otp:
        return jsonify({'error': 'Email and OTP are required.'}), 400

    doc_id = email.replace('@', '_at_').replace('.', '_')
    try:
        snap = get_db().collection('otp_store').document(doc_id).get()
    except Exception as e:
        print(f"[FIRESTORE ERROR] {e}")
        return jsonify({'error': 'Database unavailable. Please try again later.'}), 503

    if not snap.exists:
        return jsonify({'error': 'No OTP was sent to this email.'}), 400

    record = snap.to_dict()

    if record.get('used'):
        return jsonify({'error': 'This OTP has already been used.'}), 400

    # Firestore returns timezone-aware datetimes
    expires_at = record['expires_at']
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        return jsonify({'error': 'OTP has expired. Please request a new one.'}), 410

    if record['otp'] != otp:
        return jsonify({'error': 'Incorrect OTP. Please try again.'}), 400

    # Mark as used
    get_db().collection('otp_store').document(doc_id).update({'used': True})

    return jsonify({'message': 'Email verified successfully.'}), 200
