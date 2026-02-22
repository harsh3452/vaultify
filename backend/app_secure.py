import os
import io
import uuid
import datetime
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from dotenv import load_dotenv
from PIL import Image
from firebase_admin import firestore
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


# ------------------------------------------------------------------ #
#  FIRESTORE HELPERS                                                   #
# ------------------------------------------------------------------ #
def _clients_col():
    return get_db().collection('clients')

def _activity_col():
    return get_db().collection('activity')

def _find_client(owner_id, **filters):
    """Query clients collection with owner_id + extra equality filters."""
    q = _clients_col().where('owner_id', '==', owner_id)
    for field, value in filters.items():
        q = q.where(field, '==', value)
    docs = q.limit(1).stream()
    for doc in docs:
        data = doc.to_dict()
        data['_id'] = doc.id
        return data
    return None

def _find_client_by_doc_path(owner_id, firebase_path):
    """Find the client document that contains a specific document path."""
    # We query all clients for this owner, then filter in Python
    # (Firestore doesn't support array-of-map queries without composite index)
    docs = _clients_col().where('owner_id', '==', owner_id).stream()
    for doc in docs:
        data = doc.to_dict()
        data['_id'] = doc.id
        if any(d.get('firebase_path') == firebase_path for d in data.get('documents', [])):
            return data
    return None

def _find_client_with_filename(owner_id, filename):
    """Check if any client already has a doc with this filename."""
    docs = _clients_col().where('owner_id', '==', owner_id).stream()
    for doc in docs:
        data = doc.to_dict()
        if any(d.get('filename') == filename for d in data.get('documents', [])):
            return True
    return False


# ------------------------------------------------------------------ #
#  CLIENT MATCHING                                                     #
# ------------------------------------------------------------------ #
def find_or_create_client(owner_id, ai_data, detected_type):
    """
    Smart client lookup using extracted AI fields.
    Priority:
      1. Unique ID match (PAN / aadhaar_last4 / voter_id / dl)
      2. Name + DOB match
      3. Name only → needs_review, provisional client
      4. Nothing → needs_review, unknown client
    Returns (client_doc, match_type)
    """
    name        = (ai_data.get("client_name") or "").strip().replace(" ", "_").upper()
    dob         = (ai_data.get("date_of_birth") or "").strip()
    pan         = (ai_data.get("pan_number") or "").strip().upper()
    a_last4     = (ai_data.get("aadhaar_last4") or "").strip()
    voter_id    = (ai_data.get("voter_id_number") or "").strip().upper()
    dl          = (ai_data.get("dl_number") or "").strip().upper()

    # ── PRIORITY 1: Unique ID match ──────────────────────────────────
    uid_query = None
    if pan:
        client = _find_client(owner_id, pan_number=pan)
    elif a_last4 and dob:
        client = _find_client(owner_id, aadhaar_last4=a_last4, dob=dob)
    elif voter_id:
        client = _find_client(owner_id, voter_id_number=voter_id)
    elif dl:
        client = _find_client(owner_id, dl_number=dl)

    if uid_query:
        client = db.clients.find_one(uid_query)
        if client:
            # Fill in any newly discovered fields on the client record
            _update_client_fields(client["_id"], ai_data)
            print(f"    🔗 Matched by unique ID → {client['name']}")
            return client, "uid_match"

    if name and dob:
        client = _find_client(owner_id, name=name, dob=dob)
        if client:
            _update_client_fields(client['_id'], ai_data)
            print(f"    🔗 Matched by name+DOB → {client['name']}")
            return client, "name_dob_match"

    # ── PRIORITY 3: Name only → provisional, needs review ───────────
    if name and name not in ["UNKNOWN_CLIENT", "UNKNOWN"]:
        client = _find_client(owner_id, name=name)
        if client:
            _update_client_fields(client['_id'], ai_data)
            print(f"    ⚠️  Matched by name only → {client['name']}")
            return client, "name_only"
        # Create provisional client
        client = _create_client(owner_id, name, dob, ai_data, needs_review=True)
        print(f"    🆕 New provisional client (name only) → {name}")
        return client, "name_only_new"

    # ── PRIORITY 4: Nothing matched → unknown client ─────────────────
    has_uid = bool(pan or a_last4 or voter_id or dl)
    client  = _create_client(owner_id, name or "UNKNOWN_CLIENT", dob, ai_data,
                             needs_review=not (dob and has_uid))
    print(f"    ❌ No match — dumped to UNKNOWN_CLIENT")
    return client, "no_match"


def _create_client(owner_id, name, dob, ai_data, needs_review=False):
    """Create a new client record and generate their folder path."""
    folder_name = f"{name}_{dob}" if dob else name
    folder_path = f"{owner_id}/{folder_name}"

    client = {
        "owner_id":        owner_id,
        "name":            name,
        "dob":             dob,
        "pan_number":      (ai_data.get("pan_number") or "").upper(),
        "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
        "voter_id_number": (ai_data.get("voter_id_number") or "").upper(),
        "dl_number":       (ai_data.get("dl_number") or "").upper(),
        "folder_path":     folder_path,
        "documents":       [],
        "needs_review":    needs_review,
        "created_at":      firestore.SERVER_TIMESTAMP,
    }
    ref = _clients_col().document()
    ref.set(client_data)
    client_data['_id'] = ref.id
    return client_data


def _update_client_fields(client_id, ai_data):
    """Fill in any empty fields on existing client with newly discovered data."""
    updates = {}
    pan    = (ai_data.get("pan_number") or "").upper()
    a_last4 = ai_data.get("aadhaar_last4") or ""
    voter  = (ai_data.get("voter_id_number") or "").upper()
    dl     = (ai_data.get("dl_number") or "").upper()
    dob    = ai_data.get("date_of_birth") or ""

    if pan:    updates["pan_number"]      = pan
    if a_last4: updates["aadhaar_last4"]  = a_last4
    if voter:  updates["voter_id_number"] = voter
    if dl:     updates["dl_number"]       = dl
    if dob:    updates["dob"]             = dob

    if updates:
        _clients_col().document(doc_id).update(updates)


# ------------------------------------------------------------------ #
#  ACTIVITY LOG                                                        #
# ------------------------------------------------------------------ #
def log_activity(owner_id, doc_id, client_id, firebase_path, filename, doc_type, action):
    _activity_col().document().set({
        "owner_id":      owner_id,
        "doc_id":        doc_id,
        "client_id":     client_id,
        "firebase_path": firebase_path,
        "filename":      filename,
        "type":          doc_type,
        "action":        action,
        "accessed_at":   firestore.SERVER_TIMESTAMP,
    })


# ------------------------------------------------------------------ #
#  ROUTES                                                              #
# ------------------------------------------------------------------ #
@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "Vaultify Online", "encryption": ENCRYPTION_ENABLED})


@app.route('/upload', methods=['POST'])
@firebase_required
def upload():
    owner_id = request.firebase_uid
    files    = request.files.getlist('files')
    if not files:
        return jsonify({"error": "No files"}), 400

    results, errors = [], []

    for file in files:
        fname = file.filename
        if not fname:
            continue
        try:
            # STEP 0: Duplicate check by filename
            if db.clients.find_one({"owner_id": owner_id, "documents.filename": fname}):
                errors.append({"filename": fname, "error": "Already exists"})
                continue

            # Two-pass compression: AI gets high quality, storage gets compressed
            raw_bytes        = file.read()
            ai_bytes         = storage_engine.compress_to_webp_bytes(raw_bytes, fname, quality_override=85)
            ai_data          = current_brain.analyze(ai_bytes)
            compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, fname)

            # STEP 2: AI extraction (bytes directly, no temp file)
            ai_data      = current_brain.analyze(compressed_bytes)
            detected_type = TYPE_MAP.get(
                (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                ai_data.get("document_type") or "Unsorted"
            )

            client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
            needs_review       = client.get("needs_review", False)

            # STEP 4: Upload to Firebase using client's folder_path
            doc_id        = str(uuid.uuid4())
            firebase_path = storage_engine.upload_file(
                compressed_bytes,
                owner_id,
                client["folder_path"].split("/", 1)[1],
                detected_type,
                fname
            )

            # STEP 5: Append document to client record
            doc_entry = {
                "doc_id":        doc_id,
                "filename":      fname,
                "type":          detected_type,
                "firebase_path": firebase_path,
                "needs_review":  needs_review,
                "match_type":    match_type,
                "file_size":     len(compressed_bytes),
                "uploaded_at":   datetime.datetime.utcnow().isoformat(),
            }
            db.clients.update_one(
                {"_id": client["_id"]},
                {"$push": {"documents": doc_entry}}
            )

            # STEP 6: Activity log
            log_activity(owner_id, doc_id, client["_id"], firebase_path, fname, detected_type, "upload")

            print(f"✅ {fname} → {client['name']} / {detected_type} | match={match_type} | review={needs_review}")
            results.append({
                "filename":     fname,
                "client":       client["name"],
                "type":         detected_type,
                "match_type":   match_type,
                "needs_review": needs_review,
                "doc_id":       doc_id,
            })

        except Exception as e:
            print(f"❌ {fname}: {e}")
            errors.append({"filename": fname, "error": str(e)})

    status = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status


@app.route('/clients', methods=['GET'])
@firebase_required
def get_clients():
    owner_id = get_jwt_identity()
    clients  = list(db.clients.find(
        {"owner_id": owner_id},
        {"_id": 0, "owner_id": 0}
    ))
    return jsonify({"total_clients": len(clients), "clients": clients}), 200


@app.route('/clients/search', methods=['GET'])
@firebase_required
def search_clients():
    owner_id = request.firebase_uid
    q        = request.args.get('q', '').strip().upper()
    if not q:
        return jsonify({"error": "Missing query"}), 400
    docs    = _clients_col().where('owner_id', '==', owner_id).stream()
    results = []
    for doc in docs:
        data = doc.to_dict()
        if q in (data.get('name') or '').upper():
            data.pop('owner_id', None)
            results.append(data)
    return jsonify({"results": results}), 200


@app.route('/preview', methods=['GET'])
@firebase_required
def preview_file():
    owner_id      = request.firebase_uid
    firebase_path = request.args.get('path')
    if not firebase_path:
        return jsonify({"error": "Missing path"}), 400
    if not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    client = _find_client_by_doc_path(owner_id, firebase_path)
    if not client:
        return jsonify({"error": "File not found"}), 404

    doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    try:
        file_bytes = storage_engine.download_as_bytes(firebase_path)
        log_activity(owner_id, doc["doc_id"], client["_id"], firebase_path, doc["filename"], doc["type"], "preview")
        return send_file(io.BytesIO(file_bytes), mimetype='image/webp', as_attachment=False)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/download', methods=['GET'])
@firebase_required
def download_file():
    owner_id      = request.firebase_uid
    firebase_path = request.args.get('path')
    out_format    = request.args.get('format', 'jpg').lower()

    if not firebase_path:
        return jsonify({"error": "Missing path"}), 400
    if not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    client = _find_client_by_doc_path(owner_id, firebase_path)
    if not client:
        return jsonify({"error": "File not found"}), 404

    doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    try:
        file_bytes = storage_engine.download_as_bytes(firebase_path)
        dl_name    = f"{client['name']}_{doc['type']}"
        log_activity(owner_id, doc["doc_id"], client["_id"], firebase_path, doc["filename"], doc["type"], "download")

        if out_format == 'jpg':
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=95)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg', as_attachment=True, download_name=f"{dl_name}.jpg")
        elif out_format == 'pdf':
            try:
                import img2pdf
                buf = io.BytesIO(img2pdf.convert(file_bytes))
            except Exception:
                img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                buf = io.BytesIO()
                img.save(buf, 'PDF')
                buf.seek(0)
            return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{dl_name}.pdf")
        else:
            return jsonify({"error": "Use jpg or pdf"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/delete', methods=['DELETE'])
@firebase_required
def delete_file():
    owner_id      = request.firebase_uid
    firebase_path = request.args.get('path')

    if not firebase_path:
        return jsonify({"error": "Missing path"}), 400
    if not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    client = _find_client_by_doc_path(owner_id, firebase_path)
    if not client:
        return jsonify({"error": "File not found"}), 404

    try:
        storage_engine.delete_file(firebase_path)
        # Remove the document entry from the array
        doc_to_remove = next(
            (d for d in client["documents"] if d["firebase_path"] == firebase_path), None
        )
        # If client has no documents left, delete client record too
        updated = db.clients.find_one({"_id": client["_id"]})
        if updated and len(updated.get("documents", [])) == 0:
            db.clients.delete_one({"_id": client["_id"]})

        return jsonify({"message": "Deleted", "path": firebase_path}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/delete/client', methods=['DELETE'])
@firebase_required
def delete_client():
    owner_id    = request.firebase_uid
    client_name = request.args.get('client')
    if not client_name:
        return jsonify({"error": "Missing client"}), 400

    client = _find_client(owner_id, name=client_name.upper())
    if not client:
        return jsonify({"error": "Client not found"}), 404

    success, failed = [], []
    for doc in client.get("documents", []):
        try:
            storage_engine.delete_file(doc["firebase_path"])
            success.append(doc["firebase_path"])
        except Exception as e:
            failed.append({"path": doc["firebase_path"], "error": str(e)})

    _clients_col().document(client['_id']).delete()
    status = 207 if failed and success else (400 if failed else 200)
    return jsonify({"deleted": len(success), "failed": len(failed)}), status


@app.route('/dashboard', methods=['GET'])
@firebase_required
def dashboard():
    owner_id = get_jwt_identity()
    clients  = list(db.clients.find({"owner_id": owner_id}))

    total_files   = sum(len(c.get("documents", [])) for c in clients)
    needs_review  = sum(1 for c in clients if c.get("needs_review"))
    total_bytes   = sum(d.get("file_size", 0) for c in clients for d in c.get("documents", []))

    by_type = {}
    for c in clients:
        for d in c.get("documents", []):
            t = d.get("type", "Unsorted")
            by_type[t] = by_type.get(t, 0) + 1

    return jsonify({
        "total_files":     total_files,
        "total_clients":   len(clients),
        "needs_review":    needs_review,
        "by_type":         by_type,
        "storage_used_mb": round(total_bytes / (1024 * 1024), 3)
    }), 200


@app.route('/activity/recent', methods=['GET'])
@firebase_required
def recent_activity():
    owner_id = request.firebase_uid
    limit    = int(request.args.get('limit', 10))
    docs     = (_activity_col()
                .where('owner_id', '==', owner_id)
                .order_by('accessed_at', direction=firestore.Query.DESCENDING)
                .limit(limit)
                .stream())
    logs = []
    for doc in docs:
        data = doc.to_dict()
        data.pop('owner_id', None)
        ts = data.get('accessed_at')
        if ts and hasattr(ts, 'strftime'):
            data['accessed_at'] = ts.strftime("%Y-%m-%d %H:%M:%S")
        elif ts:
            data['accessed_at'] = str(ts)
        logs.append(data)
    return jsonify({"recent": logs}), 200


@app.route('/review', methods=['GET'])
@firebase_required
def get_review():
    """All clients/documents flagged for manual review."""
    owner_id = get_jwt_identity()
    clients  = list(db.clients.find(
        {"owner_id": owner_id, "needs_review": True},
        {"_id": 0, "owner_id": 0}
    ))
    return jsonify({"total": len(clients), "clients": clients}), 200


@app.route('/review/confirm', methods=['POST'])
@firebase_required
def confirm_review():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.needs_review": False}}
    )
    updated = db.clients.find_one({"_id": client["_id"]})
    if not any(d.get("needs_review") for d in updated.get("documents", [])):
        db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({"message": "Confirmed", "doc_id": doc_id}), 200


@app.route('/review/reanalyze', methods=['POST'])
@firebase_required
def reanalyze_doc():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    try:
        file_bytes = storage_engine.download_as_bytes(doc["firebase_path"])
        ai_data    = current_brain.analyze(file_bytes)

        detected_type = TYPE_MAP.get(
            (ai_data.get("document_type") or "").upper().replace(" ", "_"),
            ai_data.get("document_type") or "Unsorted"
        )
        has_uid      = bool(ai_data.get("pan_number") or ai_data.get("aadhaar_last4") or
                           ai_data.get("voter_id_number") or ai_data.get("dl_number"))
        dob          = (ai_data.get("date_of_birth") or "").replace("/", "").replace("-", "")
        needs_review = not (dob and has_uid)

        db.clients.update_one(
            {"_id": client["_id"], "documents.doc_id": doc_id},
            {"$set": {"documents.$.type": detected_type, "documents.$.needs_review": needs_review}}
        )
        _update_client_fields(client["_id"], ai_data)

        updated = db.clients.find_one({"_id": client["_id"]})
        if not any(d.get("needs_review") for d in updated.get("documents", [])):
            db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

        return jsonify({
            "message":      "Reanalyzed",
            "doc_id":       doc_id,
            "new_type":     detected_type,
            "needs_review": needs_review,
            "ai_data":      ai_data
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/review/update', methods=['PATCH'])
@firebase_required
def update_review():
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    _update_client_fields(client["_id"], data)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.needs_review": False}}
    )
    updated = db.clients.find_one({"_id": client["_id"]})
    if not any(d.get("needs_review") for d in updated.get("documents", [])):
        db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({"message": "Updated", "doc_id": doc_id}), 200


if __name__ == '__main__':
    app.run(debug=True, port=8000)