import os
import datetime
import random
import smtplib
from email.mime.text import MIMEText
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
import bcrypt
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

auth_bp = Blueprint('auth', __name__)

MONGO_URI = os.getenv("MONGO_URI")
client = MongoClient(MONGO_URI)
db = client.vaultify_db

MAIL_EMAIL    = os.getenv("MAIL_EMAIL")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")

MAIL_EMAIL    = os.getenv("MAIL_EMAIL")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")

# ------------------------------------------------------------------ #
#  HELPER: Send OTP Email                                             #
# ------------------------------------------------------------------ #
def send_otp_email(to_email, otp, mode="verify"):
    if mode == "reset":
        subject = "Vaultify — Password Reset Request"
        body = f"""Hi,

We received a request to reset your Vaultify password.

Your OTP: {otp}

This OTP is valid for 10 minutes. If you did not request this, ignore this email.

— Team Vaultify"""
    else:
        subject = "Vaultify — Verify Your Email"
        body = f"""Hi,

Welcome to Vaultify! Please verify your email to activate your account.

Your OTP: {otp}

This OTP is valid for 10 minutes.

— Team Vaultify"""

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From']    = MAIL_EMAIL
    msg['To']      = to_email

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
        server.login(MAIL_EMAIL, MAIL_PASSWORD)
        server.sendmail(MAIL_EMAIL, to_email, msg.as_string())


# ------------------------------------------------------------------ #
#  REGISTER — save user, send OTP                                     #
# ------------------------------------------------------------------ #
@auth_bp.route('/register', methods=['POST'])
def register():
    data      = request.json
    email     = data.get('email')
    password  = data.get('password')
    full_name = data.get('full_name', 'Unknown')

    if not email or not password:
        return jsonify({"error": "Email and Password required"}), 400

    if db.users.find_one({"email": email}):
        return jsonify({"error": "User already exists"}), 400

    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
    otp = str(random.randint(100000, 999999))

    db.users.insert_one({
        "email":      email,
        "password":   hashed_password,
        "full_name":  full_name,
        "is_verified": False,
        "otp":        otp,
        "otp_expiry": datetime.datetime.utcnow() + datetime.timedelta(minutes=10),
        "created_at": datetime.datetime.utcnow()
    })

    try:
        send_otp_email(email, otp, mode="verify")
    except Exception as e:
        return jsonify({"error": f"Email send failed: {str(e)}"}), 500

    return jsonify({"message": "OTP sent to email. Verify to activate account."}), 201


# ------------------------------------------------------------------ #
#  VERIFY OTP                                                         #
# ------------------------------------------------------------------ #
@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    data  = request.json
    email = data.get('email')
    otp   = data.get('otp')

    user = db.users.find_one({"email": email})
    if not user:
        return jsonify({"error": "User not found"}), 404

    if user.get('is_verified'):
        return jsonify({"message": "Already verified"}), 200

    if datetime.datetime.utcnow() > user.get('otp_expiry'):
        return jsonify({"error": "OTP expired"}), 400

    if user.get('otp') != otp:
        return jsonify({"error": "Invalid OTP"}), 400

    db.users.update_one(
        {"email": email},
        {"$set": {"is_verified": True}, "$unset": {"otp": "", "otp_expiry": ""}}
    )

    return jsonify({"message": "Email verified. You can now log in."}), 200


# ------------------------------------------------------------------ #
#  LOGIN — only verified users                                        #
# ------------------------------------------------------------------ #
@auth_bp.route('/login', methods=['POST'])
def login():
    data     = request.json
    email    = data.get('email')
    password = data.get('password')

    user = db.users.find_one({"email": email})

    if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password']):
        return jsonify({"error": "Invalid credentials"}), 401

    if not user.get('is_verified'):
        return jsonify({"error": "Email not verified. Check your inbox."}), 403

    access_token = create_access_token(identity=str(user['_id']))
    return jsonify({
        "token": access_token,
        "user":  {"email": email, "name": user['full_name']}
    }), 200


# ------------------------------------------------------------------ #
#  ME                                                                 #
# ------------------------------------------------------------------ #
# ------------------------------------------------------------------ #
#  FORGOT PASSWORD                                                    #
# ------------------------------------------------------------------ #
@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    email = request.json.get('email')
    user  = db.users.find_one({"email": email})

    if not user:
        return jsonify({"error": "User not found"}), 404

    otp = str(random.randint(100000, 999999))
    db.users.update_one(
        {"email": email},
        {"$set": {
            "otp":        otp,
            "otp_expiry": datetime.datetime.utcnow() + datetime.timedelta(minutes=10)
        }}
    )

    try:
        send_otp_email(email, otp, mode="reset")
    except Exception as e:
        return jsonify({"error": f"Email send failed: {str(e)}"}), 500

    return jsonify({"message": "OTP sent to email."}), 200


# ------------------------------------------------------------------ #
#  RESET PASSWORD                                                     #
# ------------------------------------------------------------------ #
@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data     = request.json
    email    = data.get('email')
    otp      = data.get('otp')
    new_pass = data.get('new_password')

    user = db.users.find_one({"email": email})
    if not user:
        return jsonify({"error": "User not found"}), 404

    if datetime.datetime.utcnow() > user.get('otp_expiry'):
        return jsonify({"error": "OTP expired"}), 400

    if user.get('otp') != otp:
        return jsonify({"error": "Invalid OTP"}), 400

    hashed = bcrypt.hashpw(new_pass.encode('utf-8'), bcrypt.gensalt())
    db.users.update_one(
        {"email": email},
        {"$set": {"password": hashed}, "$unset": {"otp": "", "otp_expiry": ""}}
    )

    return jsonify({"message": "Password reset successful."}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    current_user_id = get_jwt_identity()
    return jsonify({"user_id": current_user_id, "status": "Logged In"})


