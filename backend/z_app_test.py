import os
import io
import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from dotenv import load_dotenv
from PIL import Image
from storage_manager import storage_engine
from auth import auth_bp, db
from ai_engine import current_brain

load_dotenv()

app = Flask(__name__)
CORS(app)
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
JWTManager(app)
app.register_blueprint(auth_bp, url_prefix='/auth')

ENCRYPTION_ENABLED = False

TYPE_MAP = {
    "PAN": "PAN_Card", "AADHAR": "Aadhar_Card", "AADHAAR": "Aadhar_Card",
    "AADHAR_CARD": "Aadhar_Card", "VOTER": "Voter_ID", "VOTER_ID": "Voter_ID",
    "DRIVING": "Driving_License", "DRIVING_LICENSE": "Driving_License",
    "DRIVING_LICENCE": "Driving_License", "UNKNOWN": "Unsorted", "OTHER": "Unsorted"
}

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "Test Mode — AI extraction only"})


@app.route('/upload', methods=['POST'])
@jwt_required()
def upload():
    current_user_id = get_jwt_identity()
    files = request.files.getlist('files')
    if not files:
        return jsonify({"error": "No files"}), 400

    results, errors = [], []

    for file in files:
        original_filename = file.filename
        if not original_filename:
            continue

        try:
            # Duplicate check
            if db.documents.find_one({"owner_id": current_user_id, "filename": original_filename}):
                errors.append({"filename": original_filename, "error": "Already exists"})
                continue

            raw_bytes = file.read()
            compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, original_filename)

            # AI Analysis
            detected_client = "UNKNOWN_CLIENT"
            detected_type   = "Unsorted"
            needs_review    = True
            ai_data         = {}
            temp_path       = None

            try:
                temp_dir  = os.path.join(os.getcwd(), 'temp_uploads')
                os.makedirs(temp_dir, exist_ok=True)
                temp_path = os.path.join(temp_dir, f"{current_user_id}_{original_filename}.webp")
                with open(temp_path, 'wb') as f:
                    f.write(compressed_bytes)

                ai_data = current_brain.analyze(compressed_bytes)  # pass bytes directly
                detected_client = ai_data.get('client_name', 'UNKNOWN_CLIENT') or 'UNKNOWN_CLIENT'
                detected_type   = ai_data.get('document_type', 'Unsorted') or 'Unsorted'
                dob             = ai_data.get('date_of_birth', '').strip()
                if dob:
                    detected_client = f"{detected_client}_{dob}"

                detected_client = detected_client.strip().replace(" ", "_").upper()
                detected_type   = TYPE_MAP.get(detected_type.upper().replace(" ", "_"), detected_type)
                needs_review    = "UNKNOWN_CLIENT" in detected_client.upper() or detected_type.upper() in ["UNKNOWN", "UNSORTED", "OTHER"]

                print(f"🧠 {detected_client} / {detected_type} | review={needs_review} | override={ai_data.get('type_overridden')} | keywords={ai_data.get('type_keywords')}")

            except Exception as e:
                print(f"❌ AI failed: {e}")
                needs_review = True
            finally:
                if temp_path and os.path.exists(temp_path):
                    os.remove(temp_path)

            # Store (no encryption)
            data_to_store = compressed_bytes
            firebase_path = storage_engine.upload_encrypted(
                data_to_store, current_user_id, detected_client, detected_type, original_filename
            )

            db.documents.insert_one({
                "owner_id":        current_user_id,
                "filename":        original_filename,
                "firebase_path":   firebase_path,
                "client_name":     detected_client,
                "type":            detected_type,
                "needs_review":    needs_review,
                "ai_data":         ai_data,
                "file_size_bytes": len(data_to_store),
                "encrypted":       False,
                "uploaded_at": datetime.datetime.now(),
                "aadhaar_last4":   ai_data.get("aadhaar_last4", ""),
                "pan_number":      ai_data.get("pan_number", ""),
                "voter_id_number": ai_data.get("voter_id_number", ""),
                "dl_number":       ai_data.get("dl_number", ""),
                "type_keywords":   ai_data.get("type_keywords", []),
                "type_overridden": ai_data.get("type_overridden", False)
            })

            results.append({
                "filename":     original_filename,
                "client":       detected_client,
                "type":         detected_type,
                "needs_review": needs_review,
                "method":       ai_data.get('method'),
                "confidence":   ai_data.get('confidence')
            })

        except Exception as e:
            errors.append({"filename": original_filename, "error": str(e)})

    status = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status


@app.route('/documents', methods=['GET'])
@jwt_required()
def documents():
    current_user_id = get_jwt_identity()
    docs = list(db.documents.find(
        {"owner_id": current_user_id},
        {"_id": 0, "owner_id": 0, "ai_data": 0}
    ))
    grouped = {}
    for doc in docs:
        c = doc.get("client_name", "UNKNOWN_CLIENT")
        grouped.setdefault(c, []).append(doc)
    return jsonify({"total": len(docs), "clients": grouped}), 200


if __name__ == '__main__':
    app.run(debug=True, port=8000)