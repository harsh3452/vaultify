import os
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from flask import request
from flask_jwt_extended import jwt_required, get_jwt_identity
from storage_manager import storage_engine
from auth import db # Import the cloud DB connection
from ai_engine import current_brain # Import our new universal brain
from kms_manager import kms_engine
import io
from flask import send_file
from PIL import Image
import datetime

# Import the Auth logic we just wrote
from auth import auth_bp

load_dotenv()

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
# 1. Security Keys
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
jwt = JWTManager(app)

# 2. Register the Auth Routes
# This tells Flask: "Any URL starting with /auth, send it to auth.py"
app.register_blueprint(auth_bp, url_prefix='/auth')


TYPE_MAP = {
    "PAN": "PAN_Card",
    "AADHAR": "Aadhar_Card",
    "AADHAAR": "Aadhar_Card",
    "AADHAR_CARD": "Aadhar_Card",
    "VOTER": "Voter_ID",
    "VOTER_ID": "Voter_ID",
    "DRIVING": "Driving_License",
    "DRIVING_LICENSE": "Driving_License",
    "DRIVING_LICENCE": "Driving_License",
}


def log_activity(owner_id, doc, action):
    """Log file access to activity collection."""
    db.activity.insert_one({
        "owner_id":      owner_id,
        "firebase_path": doc.get("firebase_path"),
        "filename":      doc.get("filename"),
        "client_name":   doc.get("client_name"),
        "type":          doc.get("type"),
        "action":        action,  # "upload" / "preview" / "download"
        "accessed_at":   datetime.datetime.utcnow()
    })


@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status": "Secure Backend Online",
        "mode": "Cloud Storage + MongoDB Atlas"
    })
    

@app.route('/upload', methods=['POST'])
@jwt_required()
def upload_secure():
    current_user_id = get_jwt_identity()

    # Grab the list of files instead of just one
    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({"error": "No files uploaded"}), 400

    results = []
    errors = []

    for file in files:
        original_filename = file.filename
        if not original_filename:
            continue

        try:
            # STEP 0: Filename Duplicate check
            # Fast check to prevent the exact same file from being processed twice
            if db.documents.find_one({"owner_id": current_user_id, "filename": original_filename}):
                errors.append({"filename": original_filename, "error": "Exact filename already exists"})
                continue

            # STEP 1: Read bytes into RAM (no disk touch)
            raw_bytes = file.read()

            # STEP 2: Compress in RAM -> WebP bytes
            compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, original_filename)

            # STEP 3: AI Analysis (save compressed to temp disk, AI reads it, then delete)
            ai_data = {}
            detected_client = "Unknown_Client"
            detected_type = "Unsorted"
            needs_review = False
            temp_path = None

            try:
                temp_dir = os.path.join(os.getcwd(), 'temp_uploads')
                os.makedirs(temp_dir, exist_ok=True)
                
                # Unique temp name per file to prevent collision during multi-upload processing
                temp_path = os.path.join(temp_dir, f"{current_user_id}_{original_filename}_ai_temp.webp")
                
                with open(temp_path, 'wb') as f:
                    f.write(compressed_bytes)

                ai_data = current_brain.analyze(temp_path)
                detected_client = ai_data.get('client_name', 'Unknown_Client') or "Unknown_Client"
                detected_type  = ai_data.get('document_type', 'Unsorted') or "Unsorted"

                # Append DOB to client name if found to solve the "Same Name" issue
                dob = ai_data.get('date_of_birth', '').strip()
                if dob:
                    detected_client = f"{detected_client}_{dob}"

                # Normalize type
                detected_type = TYPE_MAP.get(detected_type.upper().replace(" ", "_"), detected_type)
                detected_client = detected_client.strip().replace(" ", "_").upper()
                
                # Flag for manual review if AI wasn't confident
                needs_review = "Unknown_Client" in detected_client or detected_type == "Unsorted"

                print(f"🧠 AI: {detected_client} / {detected_type} | Review: {needs_review}")

            except Exception as e:
                print(f"❌ AI Failed for {original_filename}: {e}")
                ai_data = {"error": str(e)}
                needs_review = True

            finally:
                # Always delete temp AI file
                if temp_path and os.path.exists(temp_path):
                    os.remove(temp_path)

            # STEP 4: Encrypt in RAM
            encrypted_bytes = kms_engine.encrypt(compressed_bytes)

            # STEP 5: Upload encrypted bytes to Firebase (no disk touch)
            firebase_path = storage_engine.upload_encrypted(
                encrypted_bytes,
                current_user_id,
                detected_client,
                detected_type,
                original_filename
            )

            # STEP 6: Save record to MongoDB
            db.documents.insert_one({
                "owner_id":      current_user_id,
                "filename":      original_filename,
                "firebase_path": firebase_path,
                "client_name":   detected_client,
                "type":          detected_type,
                "needs_review":  needs_review,
                "ai_analysis":   ai_data,
                "file_size_bytes":len(encrypted_bytes)
            })
            
            log_activity(current_user_id, {
                "firebase_path":firebase_path,
                "filename":original_filename,
                "client_name":detected_client,
                "type":detected_type
            }, action="upload")

            results.append({
                "filename": original_filename,
                "organized_under": f"{detected_client}/{detected_type}",
                "firebase_path": firebase_path,
                "needs_review": needs_review
            })

        except Exception as e:
            errors.append({"filename": original_filename, "error": str(e)})

    # Return 207 Multi-Status if some failed, 201 if all succeeded
    status_code = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status_code


@app.route('/documents', methods=['GET'])
@jwt_required()
def get_documents():
    current_user_id = get_jwt_identity()

    docs = list(db.documents.find(
        {"owner_id": current_user_id},
        {"_id": 0, "owner_id": 0, "ai_analysis": 0}  # exclude heavy/sensitive fields
    ))

    # Group by client_name for frontend folder view
    grouped = {}
    for doc in docs:
        client = doc.get("client_name", "Unknown_Client")
        if client not in grouped:
            grouped[client] = []
        grouped[client].append({
            "filename":      doc.get("filename"),
            "type":          doc.get("type"),
            "firebase_path": doc.get("firebase_path"),
            "needs_review":  doc.get("needs_review", False)
        })

    return jsonify({
        "total_files":   len(docs),
        "total_clients": len(grouped),
        "clients":       grouped
    }), 200


@app.route('/preview', methods=['GET'])
@jwt_required()
def preview_file():
    current_user_id = get_jwt_identity()
    firebase_path = request.args.get('path')

    if not firebase_path:
        return jsonify({"error": "Missing path parameter"}), 400

    # Security check — path must start with current user's ID
    if not firebase_path.startswith(current_user_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    # Verify file belongs to user in MongoDB
    doc = db.documents.find_one({
        "owner_id":      current_user_id,
        "firebase_path": firebase_path
    })
    if not doc:
        return jsonify({"error": "File not found"}), 404

    try:
        # Fetch encrypted bytes from Firebase
        encrypted_bytes = storage_engine.download_as_bytes(firebase_path)

        # Decrypt in RAM
        decrypted_bytes = kms_engine.decrypt(encrypted_bytes)

        log_activity(current_user_id, doc, action="preview")
        # Stream as image
        return send_file(
            io.BytesIO(decrypted_bytes),
            mimetype='image/webp',
            as_attachment=False
        )
       
    except Exception as e:
        print(f"❌ Preview error: {e}")
        return jsonify({"error": "Could not decrypt file"}), 500


@app.route('/download', methods=['GET'])
@jwt_required()
def download_file():
    current_user_id = get_jwt_identity()
    firebase_path = request.args.get('path')
    out_format = request.args.get('format', 'jpg').lower()

    if not firebase_path:
        return jsonify({"error": "Missing path parameter"}), 400

    if not firebase_path.startswith(current_user_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    doc = db.documents.find_one({
        "owner_id":      current_user_id,
        "firebase_path": firebase_path
    })
    if not doc:
        return jsonify({"error": "File not found"}), 404

    try:
        encrypted_bytes = storage_engine.download_as_bytes(firebase_path)
        decrypted_bytes = kms_engine.decrypt(encrypted_bytes)
        base_name = os.path.splitext(doc.get("filename", "document"))[0]

        # Log BEFORE send_file
        log_activity(current_user_id, doc, action="download")

        if out_format == 'jpg':
            img = Image.open(io.BytesIO(decrypted_bytes)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=95)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg', as_attachment=True, download_name=f"{base_name}.jpg")

        elif out_format == 'pdf':
            try:
                import img2pdf
                pdf_bytes = img2pdf.convert(decrypted_bytes)
                return send_file(io.BytesIO(pdf_bytes), mimetype='application/pdf', as_attachment=True, download_name=f"{base_name}.pdf")
            except Exception:
                img = Image.open(io.BytesIO(decrypted_bytes)).convert("RGB")
                buf = io.BytesIO()
                img.save(buf, 'PDF')
                buf.seek(0)
                return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{base_name}.pdf")

        else:
            return jsonify({"error": "Invalid format. Use jpg or pdf"}), 400

    except Exception as e:
        print(f"❌ Download error: {e}")
        return jsonify({"error": "Could not process file"}), 500

@app.route('/delete', methods=['DELETE'])
@jwt_required()
def delete_file():
    current_user_id = get_jwt_identity()
    firebase_path = request.args.get('path')

    if not firebase_path:
        return jsonify({"error": "Missing path parameter"}), 400

    # Security: must belong to current user
    if not firebase_path.startswith(current_user_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    # Verify exists in MongoDB
    doc = db.documents.find_one({
        "owner_id": current_user_id,
        "firebase_path": firebase_path
    })
    if not doc:
        return jsonify({"error": "File not found"}), 404

    try:
        # 1. Delete from Firebase
        storage_engine.delete_file(firebase_path)

        # 2. Delete from MongoDB
        db.documents.delete_one({
            "owner_id": current_user_id,
            "firebase_path": firebase_path
        })

        return jsonify({"message": "File deleted successfully", "path": firebase_path}), 200

    except Exception as e:
        print(f"❌ Delete error: {e}")
        return jsonify({"error": "Delete failed", "details": str(e)}), 500
    
    
@app.route('/dashboard', methods=['GET'])
@jwt_required()
def dashboard_stats():
    current_user_id = get_jwt_identity()

    docs = list(db.documents.find(
        {"owner_id": current_user_id},
        {"_id": 0, "client_name": 1, "type": 1, "firebase_path": 1, "needs_review": 1, "file_size_bytes": 1}
    ))

    if not docs:
        return jsonify({
            "total_files": 0,
            "total_clients": 0,
            "needs_review": 0,
            "by_type": {},
            "storage_used_mb": 0
        }), 200

    # Aggregations
    clients = set(doc["client_name"] for doc in docs)
    needs_review = sum(1 for doc in docs if doc.get("needs_review"))

    by_type = {}
    for doc in docs:
        t = doc.get("type", "Unsorted")
        by_type[t] = by_type.get(t, 0) + 1

    # Storage estimate from Firebase -> directly from mongo. Each doc has file_size_bytes which is the size of the encrypted file in Firebase. This is more accurate than summing compressed sizes or estimating from AI data.
    total_bytes = sum(doc.get("file_size_bytes", 0) for doc in docs)


    return jsonify({
        "total_files":      len(docs),
        "total_clients":    len(clients),
        "needs_review":     needs_review,
        "by_type":          by_type,
        "storage_used_mb":  round(total_bytes / (1024 * 1024), 3)
    }), 200

     
@app.route('/delete/client', methods=['DELETE'])
@jwt_required()
def delete_client():
    current_user_id = get_jwt_identity()
    client_name = request.args.get('client')

    if not client_name:
        return jsonify({"error": "Missing client parameter"}), 400

    docs = list(db.documents.find({
        "owner_id":    current_user_id,
        "client_name": client_name
    }))

    if not docs:
        return jsonify({"error": "Client not found"}), 404

    success, failed = [], []

    for doc in docs:
        path = doc["firebase_path"]
        try:
            storage_engine.delete_file(path)
            db.documents.delete_one({"_id": doc["_id"]})
            success.append(path)
        except Exception as e:
            failed.append({"path": path, "error": str(e)})

    status = 207 if failed and success else (400 if failed else 200)
    return jsonify({
        "deleted": len(success),
        "failed":  len(failed),
        "details": {"success": success, "failed": failed}
    }), status
    

@app.route('/activity/recent', methods=['GET'])
@jwt_required()
def recent_activity():
    current_user_id = get_jwt_identity()
    limit = int(request.args.get('limit', 10))

    logs = list(db.activity.find(
        {"owner_id": current_user_id},
        {"_id": 0, "owner_id": 0}
    ).sort("accessed_at", -1).limit(limit))

    # Convert datetime to string for JSON
    for log in logs:
        log["accessed_at"] = log["accessed_at"].strftime("%Y-%m-%d %H:%M:%S")

    return jsonify({"recent": logs}), 200
              
if __name__ == '__main__':
    # Run on Port 8000 to avoid conflict with old app
    app.run(debug=True, port=8000)