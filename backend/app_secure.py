import os
import io
import uuid
import datetime
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
from storage_manager import storage_engine
from auth import auth_bp, db, firebase_required
from ai_engine import current_brain

load_dotenv()

app = Flask(__name__)
CORS(app)
app.register_blueprint(auth_bp, url_prefix='/auth')

ENCRYPTION_ENABLED = False

TYPE_MAP = {
    "PAN": "PAN_Card", "AADHAR": "Aadhar_Card", "AADHAAR": "Aadhar_Card",
    "AADHAR_CARD": "Aadhar_Card", "VOTER": "Voter_ID", "VOTER_ID": "Voter_ID",
    "DRIVING": "Driving_License", "DRIVING_LICENSE": "Driving_License",
    "DRIVING_LICENCE": "Driving_License", "UNKNOWN": "Unsorted", "OTHER": "Unsorted"
}

# Names the AI returns when it can't identify the document holder
UNKNOWN_CLIENT_NAMES = {
    "", "UNKNOWN", "UNKNOWN_CLIENT", "UNKNOWN_NAME", "NA", "N/A", "NONE",
    "NOT_AVAILABLE", "NOT_FOUND", "UNIDENTIFIED"
}


# ------------------------------------------------------------------ #
#  CLIENT MATCHING                                                     #
# ------------------------------------------------------------------ #
def find_or_create_client(owner_id, ai_data, detected_type):
    name     = (ai_data.get("client_name") or "").strip().replace(" ", "_").upper()
    dob      = (ai_data.get("date_of_birth") or "").strip()
    dob      = dob.replace("/", "").replace("-", "")
    pan      = (ai_data.get("pan_number") or "").strip().upper()
    a_last4  = (ai_data.get("aadhaar_last4") or "").strip()
    voter_id = (ai_data.get("voter_id_number") or "").strip().upper()
    dl       = (ai_data.get("dl_number") or "").strip().upper()

    uid_query = None
    if pan:
        uid_query = {"owner_id": owner_id, "pan_number": pan}
    elif a_last4 and dob:
        uid_query = {"owner_id": owner_id, "aadhaar_last4": a_last4, "dob": dob}
    elif voter_id:
        uid_query = {"owner_id": owner_id, "voter_id_number": voter_id}
    elif dl:
        uid_query = {"owner_id": owner_id, "dl_number": dl}

    if uid_query:
        client = db.clients.find_one(uid_query)
        if client:
            _update_client_fields(client["_id"], ai_data)
            print(f"    🔗 Matched by unique ID → {client['name']}")
            return client, "uid_match"

    if name and dob:
        client = db.clients.find_one({"owner_id": owner_id, "name": name, "dob": dob})
        if client:
            _update_client_fields(client["_id"], ai_data)
            print(f"    🔗 Matched by name+DOB → {client['name']}")
            return client, "name_dob_match"

    if name and name not in UNKNOWN_CLIENT_NAMES:
        client = db.clients.find_one({"owner_id": owner_id, "name": name})
        if client:
            _update_client_fields(client["_id"], ai_data)
            print(f"    ⚠️  Matched by name only (needs review) → {client['name']}")
            return client, "name_only"
        has_uid = bool(pan or a_last4 or voter_id or dl)
        client  = _create_client(owner_id, name, dob, ai_data, needs_review=not (dob and has_uid))
        print(f"    🆕 New provisional client (name only) → {name}")
        return client, "name_only_new"

    # All unknown / unidentified documents go into one shared folder
    existing = db.clients.find_one({"owner_id": owner_id, "name": "UNKNOWN_CLIENT"})
    if existing:
        _update_client_fields(existing["_id"], ai_data)
        print(f"    ❌ No match — appended to shared UNKNOWN_CLIENT")
        return existing, "no_match"

    client = _create_client(owner_id, "UNKNOWN_CLIENT", "", ai_data, needs_review=True,
                            force_folder="UNKNOWN_CLIENT")
    print(f"    ❌ No match — created shared UNKNOWN_CLIENT")
    return client, "no_match"


def _create_client(owner_id, name, dob, ai_data, needs_review=False, force_folder=None):
    folder_name = force_folder or (f"{name}_{dob}" if dob else name)
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
        "created_at":      datetime.datetime.now()
    }
    result = db.clients.insert_one(client)
    client["_id"] = result.inserted_id
    return client


def _update_client_fields(client_id, ai_data):
    updates = {}
    pan    = (ai_data.get("pan_number") or "").upper()
    a_last4 = ai_data.get("aadhaar_last4") or ""
    voter  = (ai_data.get("voter_id_number") or "").upper()
    dl     = (ai_data.get("dl_number") or "").upper()
    dob    = ai_data.get("date_of_birth") or ""
    if pan:     updates["pan_number"]      = pan
    if a_last4: updates["aadhaar_last4"]   = a_last4
    if voter:   updates["voter_id_number"] = voter
    if dl:      updates["dl_number"]       = dl
    if dob:     updates["dob"]             = dob
    if updates:
        db.clients.update_one({"_id": client_id}, {"$set": updates})


# ------------------------------------------------------------------ #
#  ACTIVITY LOG                                                        #
# ------------------------------------------------------------------ #
def log_activity(owner_id, doc_id, client_id, firebase_path, filename, doc_type, action):
    db.activity.insert_one({
        "owner_id":      owner_id,
        "doc_id":        doc_id,
        "client_id":     str(client_id),
        "firebase_path": firebase_path,
        "filename":      filename,
        "type":          doc_type,
        "action":        action,
        "accessed_at":   datetime.datetime.now()
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
            if db.clients.find_one({"owner_id": owner_id, "documents.filename": fname}):
                errors.append({"filename": fname, "error": "Already exists"})
                continue

            # Two-pass compression: AI gets high quality, storage gets compressed
            raw_bytes        = file.read()
            ai_bytes         = storage_engine.compress_to_webp_bytes(raw_bytes, fname, quality_override=85)
            ai_data          = current_brain.analyze(ai_bytes)
            compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, fname)

            detected_type = TYPE_MAP.get(
                (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                ai_data.get("document_type") or "Unsorted"
            )

            client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
            needs_review       = client.get("needs_review", False)

            doc_id        = str(uuid.uuid4())
            firebase_path = storage_engine.upload_file(
                compressed_bytes,
                owner_id,
                client["folder_path"].split("/", 1)[1],
                detected_type,
                fname
            )

            doc_entry = {
                "doc_id":        doc_id,
                "filename":      fname,
                "type":          detected_type,
                "firebase_path": firebase_path,
                "needs_review":  needs_review,
                "match_type":    match_type,
                "file_size":     len(compressed_bytes),
                "uploaded_at":   datetime.datetime.now()
            }
            db.clients.update_one({"_id": client["_id"]}, {"$push": {"documents": doc_entry}})
            log_activity(owner_id, doc_id, client["_id"], firebase_path, fname, detected_type, "upload")

            print(f"✅ {fname} → {client['name']} / {detected_type} | match={match_type} | review={needs_review}")
            results.append({
                "filename":     fname,
                "client":       client["name"],
                "type":         detected_type,
                "match_type":   match_type,
                "needs_review": needs_review,
                "doc_id":       doc_id
            })

        except Exception as e:
            print(f"❌ {fname}: {e}")
            errors.append({"filename": fname, "error": str(e)})

    status = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status


@app.route('/clients', methods=['GET'])
@firebase_required
def get_clients():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))

    # Strip soft-deleted documents before returning
    for c in clients:
        c["documents"] = [d for d in c.get("documents", []) if not d.get("deleted_at")]

    # Merge all unknown-named clients into a single UNKNOWN_CLIENT bucket
    merged, unknown_bucket = [], None
    for c in clients:
        if (c.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES:
            if unknown_bucket is None:
                unknown_bucket = {**c, "name": "UNKNOWN_CLIENT", "documents": list(c.get("documents", []))}
            else:
                unknown_bucket["documents"].extend(c.get("documents", []))
        else:
            merged.append(c)
    if unknown_bucket:
        merged.append(unknown_bucket)

    return jsonify({"total_clients": len(merged), "clients": merged}), 200


@app.route('/clients/search', methods=['GET'])
@firebase_required
def search_clients():
    owner_id = request.firebase_uid
    q        = request.args.get('q', '').strip().upper()
    if not q:
        return jsonify({"error": "Missing query"}), 400
    clients = list(db.clients.find(
        {"owner_id": owner_id, "name": {"$regex": q, "$options": "i"}},
        {"_id": 0, "owner_id": 0}
    ))
    return jsonify({"results": clients}), 200


@app.route('/search', methods=['GET'])
@firebase_required
def search_all():
    """Search clients by name AND documents by filename / type."""
    owner_id = request.firebase_uid
    q = request.args.get('q', '').strip()
    if not q or len(q) < 2:
        return jsonify({"error": "Query must be at least 2 characters"}), 400

    regex = {"$regex": q, "$options": "i"}
    clients = list(db.clients.find(
        {"owner_id": owner_id,
         "$or": [
             {"name": regex},
             {"documents.filename": regex},
             {"documents.type": regex},
         ]},
        {"_id": 0, "owner_id": 0}
    ))

    # Flatten matching documents with their client context
    results = []
    for c in clients:
        for doc in c.get("documents", []):
            fn  = doc.get("filename", "")
            dt  = doc.get("type", "")
            cn  = c.get("name", "")
            if (q.lower() in fn.lower() or q.lower() in dt.lower()
                    or q.lower() in cn.lower()):
                results.append({
                    "client_name":  cn,
                    "filename":     fn,
                    "type":         dt,
                    "firebase_path": doc.get("firebase_path"),
                    "file_size":    doc.get("file_size", 0),
                    "doc_id":       doc.get("doc_id"),
                    "needs_review": doc.get("needs_review", False),
                    "uploaded_at":  doc.get("uploaded_at", "").strftime("%Y-%m-%d %H:%M:%S")
                                    if hasattr(doc.get("uploaded_at", ""), "strftime") else "",
                })

    return jsonify({"query": q, "total": len(results), "results": results}), 200


@app.route('/preview', methods=['GET'])
@firebase_required
def preview_file():
    owner_id      = request.firebase_uid
    firebase_path = request.args.get('path')
    if not firebase_path:
        return jsonify({"error": "Missing path"}), 400
    if not firebase_path.startswith(owner_id + "/"):
        return jsonify({"error": "Unauthorized"}), 403

    client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
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

    client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
    if not client:
        return jsonify({"error": "File not found"}), 404

    doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    rotation = int(request.args.get('rotation', 0)) % 360
    try:
        file_bytes = storage_engine.download_as_bytes(firebase_path)
        dl_name    = f"{client['name']}_{doc['type']}"
        log_activity(owner_id, doc["doc_id"], client["_id"], firebase_path, doc["filename"], doc["type"], "download")

        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        if rotation:
            img = img.rotate(-rotation, expand=True)

        if out_format == 'jpg':
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=95)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg', as_attachment=True, download_name=f"{dl_name}.jpg")
        elif out_format == 'pdf':
            if not rotation:
                try:
                    import img2pdf
                    raw = storage_engine.download_as_bytes(firebase_path)
                    buf = io.BytesIO(img2pdf.convert(raw))
                    return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{dl_name}.pdf")
                except Exception:
                    pass
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

    client = db.clients.find_one({"owner_id": owner_id, "documents.firebase_path": firebase_path})
    if not client:
        return jsonify({"error": "File not found"}), 404

    try:
        storage_engine.delete_file(firebase_path)
        db.clients.update_one(
            {"_id": client["_id"]},
            {"$pull": {"documents": {"firebase_path": firebase_path}}}
        )
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

    client = db.clients.find_one({"owner_id": owner_id, "name": client_name.upper()})
    if not client:
        return jsonify({"error": "Client not found"}), 404

    success, failed = [], []
    for doc in client.get("documents", []):
        try:
            storage_engine.delete_file(doc["firebase_path"])
            success.append(doc["firebase_path"])
        except Exception as e:
            failed.append({"path": doc["firebase_path"], "error": str(e)})

    db.clients.delete_one({"_id": client["_id"]})
    status = 207 if failed and success else (400 if failed else 200)
    return jsonify({"deleted": len(success), "failed": len(failed)}), status


@app.route('/dashboard', methods=['GET'])
@firebase_required
def dashboard():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}))

    total_files  = sum(len(c.get("documents", [])) for c in clients)
    needs_review = sum(1 for c in clients if c.get("needs_review"))
    total_bytes  = sum(d.get("file_size", 0) for c in clients for d in c.get("documents", []))

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
    logs     = list(db.activity.find(
        {"owner_id": owner_id},
        {"_id": 0, "owner_id": 0}
    ).sort("accessed_at", -1).limit(limit))
    for log in logs:
        log["accessed_at"] = log["accessed_at"].strftime("%Y-%m-%d %H:%M:%S")
    return jsonify({"recent": logs}), 200


@app.route('/review', methods=['GET'])
@firebase_required
def get_review():
    owner_id = request.firebase_uid

    # Clients already flagged for review
    review_clients = list(db.clients.find(
        {"owner_id": owner_id, "needs_review": True},
        {"_id": 0, "owner_id": 0}
    ))

    # Also always include UNKNOWN_CLIENT-named clients (they are always in review)
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

    # Strip soft-deleted docs from each client
    for c in review_clients:
        c["documents"] = [d for d in c.get("documents", []) if not d.get("deleted_at")]

    review_clients = [c for c in review_clients if c["documents"]]
    return jsonify({"total": len(review_clients), "clients": review_clients}), 200


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

    # Never allow confirming away UNKNOWN_CLIENT documents — they stay in review
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


@app.route('/review/reanalyze', methods=['POST'])
@firebase_required
def reanalyze_doc():
    """Re-run AI on the document. NEVER moves the file or reassigns to a different client.
    For UNKNOWN_CLIENT records, needs_review stays True regardless of AI result."""
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Document not found"}), 404

    is_unknown = (client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES

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
        # UNKNOWN_CLIENT docs always stay in review until manually resolved
        needs_review = True if is_unknown else not (dob and has_uid)

        # Update doc metadata in-place. firebase_path is intentionally NOT changed.
        db.clients.update_one(
            {"_id": client["_id"], "documents.doc_id": doc_id},
            {"$set": {"documents.$.type": detected_type, "documents.$.needs_review": needs_review}}
        )
        # Persist any new identification data onto the client record
        _update_client_fields(client["_id"], ai_data)

        # Only clear client-level needs_review flag if not UNKNOWN and no remaining review docs
        if not is_unknown:
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


# ------------------------------------------------------------------ #
#  DOCUMENT ACTIONS (star / trash / move / type override / bulk)      #
# ------------------------------------------------------------------ #

@app.route('/documents/star', methods=['POST'])
@firebase_required
def toggle_star():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc     = next(d for d in client["documents"] if d["doc_id"] == doc_id)
    new_val = not doc.get("starred", False)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.starred": new_val}}
    )
    return jsonify({"starred": new_val}), 200


@app.route('/documents/starred', methods=['GET'])
@firebase_required
def get_starred():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))
    results  = []
    for c in clients:
        for doc in c.get("documents", []):
            if doc.get("starred") and not doc.get("deleted_at"):
                d = {**doc, "client_name": c["name"]}
                if hasattr(d.get("uploaded_at"), "strftime"):
                    d["uploaded_at"] = d["uploaded_at"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(d)
    return jsonify({"results": results}), 200


@app.route('/documents/trash', methods=['POST'])
@firebase_required
def trash_doc():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": datetime.datetime.now(),
                  "documents.$.starred":    False}}
    )
    return jsonify({"message": "Moved to trash"}), 200


@app.route('/documents/trash', methods=['GET'])
@firebase_required
def get_trash():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))
    results  = []
    for c in clients:
        for doc in c.get("documents", []):
            if doc.get("deleted_at"):
                d = {**doc, "client_name": c["name"]}
                if hasattr(d.get("deleted_at"), "strftime"):
                    d["deleted_at"] = d["deleted_at"].strftime("%Y-%m-%d %H:%M:%S")
                if hasattr(d.get("uploaded_at"), "strftime"):
                    d["uploaded_at"] = d["uploaded_at"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(d)
    return jsonify({"results": results}), 200


@app.route('/documents/restore', methods=['POST'])
@firebase_required
def restore_doc():
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": None}}
    )
    return jsonify({"message": "Restored"}), 200


@app.route('/documents/trash/purge', methods=['DELETE'])
@firebase_required
def purge_doc():
    owner_id = request.firebase_uid
    doc_id   = request.args.get('doc_id')
    client   = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    try:
        if doc:
            storage_engine.delete_file(doc["firebase_path"])
    except Exception:
        pass
    db.clients.update_one({"_id": client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
    updated = db.clients.find_one({"_id": client["_id"]})
    if updated and len(updated.get("documents", [])) == 0:
        db.clients.delete_one({"_id": client["_id"]})
    return jsonify({"message": "Permanently deleted"}), 200


@app.route('/documents/type', methods=['PATCH'])
@firebase_required
def update_doc_type():
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    new_type = data.get('type')
    if not doc_id or not new_type:
        return jsonify({"error": "Missing doc_id or type"}), 400
    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.type": new_type, "documents.$.needs_review": False}}
    )
    return jsonify({"message": "Updated", "type": new_type}), 200


@app.route('/documents/metadata', methods=['PATCH'])
@firebase_required
def update_doc_metadata():
    """Update client-level identity fields + doc type in one call.
    NEVER moves the document — firebase_path stays untouched."""
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not client:
        return jsonify({"error": "Not found"}), 404

    is_unknown = (client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES

    # ── Client-level fields ──
    client_updates = {}
    for field in ("name", "dob", "pan_number", "aadhaar_last4",
                  "voter_id_number", "dl_number"):
        val = data.get(field)
        if val is not None:
            client_updates[field] = val.strip() if isinstance(val, str) else val

    if client_updates:
        db.clients.update_one({"_id": client["_id"]}, {"$set": client_updates})

    # ── Document-level fields ──
    doc_updates = {}
    if data.get('type'):
        doc_updates["documents.$.type"] = data['type']

    # A document is resolved from review only if:
    # - client is not UNKNOWN (unknown stays in review always)
    # - the required metadata is now complete
    new_name = client_updates.get("name", client.get("name", ""))
    new_dob  = client_updates.get("dob", client.get("dob", ""))
    pan      = client_updates.get("pan_number", client.get("pan_number", ""))
    a_last4  = client_updates.get("aadhaar_last4", client.get("aadhaar_last4", ""))
    voter    = client_updates.get("voter_id_number", client.get("voter_id_number", ""))
    dl       = client_updates.get("dl_number", client.get("dl_number", ""))
    has_uid  = bool(pan or a_last4 or voter or dl)
    still_unknown = (new_name.upper() in UNKNOWN_CLIENT_NAMES) if new_name else True
    doc_updates["documents.$.needs_review"] = still_unknown or not (new_dob and has_uid)

    if doc_updates:
        db.clients.update_one(
            {"_id": client["_id"], "documents.doc_id": doc_id},
            {"$set": doc_updates}
        )

    # Re-evaluate client-level needs_review
    if not still_unknown:
        updated = db.clients.find_one({"_id": client["_id"]})
        if not any(d.get("needs_review") for d in updated.get("documents", [])):
            db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({"message": "Metadata updated", "doc_id": doc_id}), 200


@app.route('/documents/bulk', methods=['POST'])
@firebase_required
def bulk_action():
    """Bulk: action = 'trash' | 'restore' | 'star' | 'reanalyze' | 'delete_permanent'"""
    owner_id = request.firebase_uid
    data     = request.json
    action   = data.get('action')
    doc_ids  = data.get('doc_ids', [])
    if not doc_ids or not action:
        return jsonify({"error": "Missing action or doc_ids"}), 400

    processed = []
    for doc_id in doc_ids:
        client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if not client:
            continue
        doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
        if not doc:
            continue
        try:
            if action == 'trash':
                db.clients.update_one(
                    {"_id": client["_id"], "documents.doc_id": doc_id},
                    {"$set": {"documents.$.deleted_at": datetime.datetime.now()}}
                )
            elif action == 'restore':
                db.clients.update_one(
                    {"_id": client["_id"], "documents.doc_id": doc_id},
                    {"$set": {"documents.$.deleted_at": None}}
                )
            elif action == 'star':
                new_val = not doc.get("starred", False)
                db.clients.update_one(
                    {"_id": client["_id"], "documents.doc_id": doc_id},
                    {"$set": {"documents.$.starred": new_val}}
                )
            elif action == 'reanalyze':
                is_unknown    = (client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES
                file_bytes    = storage_engine.download_as_bytes(doc["firebase_path"])
                ai_data       = current_brain.analyze(file_bytes)
                detected_type = TYPE_MAP.get(
                    (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                    ai_data.get("document_type") or "Unsorted"
                )
                has_uid      = bool(ai_data.get("pan_number") or ai_data.get("aadhaar_last4") or
                                    ai_data.get("voter_id_number") or ai_data.get("dl_number"))
                dob          = (ai_data.get("date_of_birth") or "").replace("/", "").replace("-", "")
                needs_review = True if is_unknown else not (dob and has_uid)
                db.clients.update_one(
                    {"_id": client["_id"], "documents.doc_id": doc_id},
                    {"$set": {"documents.$.type": detected_type,
                              "documents.$.needs_review": needs_review}}
                )
                _update_client_fields(client["_id"], ai_data)
            elif action == 'delete_permanent':
                try:
                    storage_engine.delete_file(doc["firebase_path"])
                except Exception:
                    pass
                db.clients.update_one(
                    {"_id": client["_id"]},
                    {"$pull": {"documents": {"doc_id": doc_id}}}
                )
            processed.append(doc_id)
        except Exception as e:
            print(f"Bulk {action} failed for {doc_id}: {e}")

    return jsonify({"processed": len(processed), "doc_ids": processed}), 200


@app.route('/documents/move', methods=['POST'])
@firebase_required
def move_doc():
    """Move a document to a different client record."""
    owner_id       = request.firebase_uid
    doc_id         = request.json.get('doc_id')
    target_client_name = (request.json.get('target_client') or "").strip().upper()
    if not doc_id or not target_client_name:
        return jsonify({"error": "Missing doc_id or target_client"}), 400

    src_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not src_client:
        return jsonify({"error": "Document not found"}), 404
    dst_client = db.clients.find_one({"owner_id": owner_id, "name": target_client_name})
    if not dst_client:
        return jsonify({"error": "Target client not found"}), 404
    if str(src_client["_id"]) == str(dst_client["_id"]):
        return jsonify({"error": "Source and target are the same"}), 400

    doc = next((d for d in src_client["documents"] if d["doc_id"] == doc_id), None)
    # Pull from source
    db.clients.update_one({"_id": src_client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
    # Push to dest
    db.clients.update_one({"_id": dst_client["_id"]}, {"$push": {"documents": doc}})
    # Clean up empty source
    updated_src = db.clients.find_one({"_id": src_client["_id"]})
    if updated_src and len(updated_src.get("documents", [])) == 0:
        db.clients.delete_one({"_id": src_client["_id"]})

    return jsonify({"message": "Moved", "to": target_client_name}), 200


if __name__ == '__main__':
    app.run(debug=True, port=8000)