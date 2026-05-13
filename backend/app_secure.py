import os
import io
import uuid
import hashlib
import datetime
from flask import Flask, jsonify, request, send_file, make_response
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
from storage_manager import storage_engine
from auth import auth_bp, db, firebase_required
from ai_engine import current_brain, gemini_brain, id_classifier
from kms_manager import kms_engine

load_dotenv()

app = Flask(__name__)
CORS(app)
app.register_blueprint(auth_bp, url_prefix='/auth')

ENCRYPTION_ENABLED = True


def _download_smart(firebase_path, owner_id):
    """Download file, auto-decrypting if the path ends in .enc."""
    if firebase_path.endswith(".enc"):
        dek = kms_engine.get_or_create_dek(owner_id, db)
        return storage_engine.download_decrypted(firebase_path, dek)
    return storage_engine.download_as_bytes(firebase_path)

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
    name     = " ".join((ai_data.get("client_name") or "").strip().split()).replace(" ", "_").upper()
    dob      = (ai_data.get("date_of_birth") or "").strip()
    dob      = dob.replace("/", "").replace("-", "")
    pan      = (ai_data.get("pan_number") or "").strip().upper()
    a_last4  = (ai_data.get("aadhaar_last4") or "").strip()
    voter_id = (ai_data.get("voter_id_number") or "").strip().upper()
    dl       = (ai_data.get("dl_number") or "").strip().upper()

    # UID queries must exclude UNKNOWN_CLIENT names — otherwise UIDs
    # that leaked onto the shared bucket would hijack every reanalyze.
    _not_unknown = {"name": {"$nin": list(UNKNOWN_CLIENT_NAMES)}}

    uid_query = None
    if pan:
        uid_query = {"owner_id": owner_id, "pan_number": pan, **_not_unknown}
    elif a_last4 and dob:
        uid_query = {"owner_id": owner_id, "aadhaar_last4": a_last4, "dob": dob, **_not_unknown}
    elif voter_id:
        uid_query = {"owner_id": owner_id, "voter_id_number": voter_id, **_not_unknown}
    elif dl:
        uid_query = {"owner_id": owner_id, "dl_number": dl, **_not_unknown}

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
        has_strong_uid = bool(pan or voter_id or dl)   # Aadhaar alone is weak (last4 only)
        # Cleared from review if we have: a strong UID, OR name+DOB, OR name+any UID
        confident = has_strong_uid or (bool(name) and bool(dob)) or (bool(name) and bool(a_last4))
        client  = _create_client(owner_id, name, dob, ai_data, needs_review=not confident)
        print(f"    🆕 New provisional client → {name}")
        return client, "name_only_new"

    # All unknown / unidentified documents go into one shared folder.
    # IMPORTANT: do NOT call _update_client_fields here — UNKNOWN_CLIENT
    # must never carry per-person UIDs or it will hijack UID queries.
    existing = db.clients.find_one({"owner_id": owner_id, "name": "UNKNOWN_CLIENT"})
    if existing:
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


def _get_or_create_pending_folder(owner_id):
    """Return (or create) the shared Unsorted_Pending folder for this user."""
    existing = db.clients.find_one({"owner_id": owner_id, "name": "Unsorted_Pending"})
    if existing:
        return existing
    folder_path = f"{owner_id}/Unsorted_Pending"
    client = {
        "owner_id":        owner_id,
        "name":            "Unsorted_Pending",
        "dob":             "",
        "pan_number":      "",
        "aadhaar_last4":   "",
        "voter_id_number": "",
        "dl_number":       "",
        "folder_path":     folder_path,
        "documents":       [],
        "needs_review":    True,
        "is_pending_folder": True,
        "created_at":      datetime.datetime.now()
    }
    result = db.clients.insert_one(client)
    client["_id"] = result.inserted_id
    return client


def _cleanup_empty_client(client_id):
    """Delete a client record if it has zero (non-deleted) documents."""
    client = db.clients.find_one({"_id": client_id})
    if not client:
        return
    live_docs = [d for d in client.get("documents", []) if not d.get("deleted_at")]
    if len(live_docs) == 0:
        db.clients.delete_one({"_id": client_id})
        print(f"    🗑️  Deleted empty client folder: {client.get('name')}")


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
    _DEDUP_SECONDS = 300  # 5 min – skip duplicate preview logs

def log_activity(owner_id, doc_id, client_id, firebase_path, filename,
                 doc_type, action, client_name="", extra=None):
    now = datetime.datetime.now()

    # De-duplicate preview: if the same user previewed the same doc within
    # the last N seconds, skip the insert to avoid log flooding.
    if action == "preview":
        cutoff = now - datetime.timedelta(seconds=PREVIEW_DEDUP_SECONDS)
        dup = db.activity.find_one({
            "owner_id": owner_id,
            "doc_id":   doc_id,
            "action":   "preview",
            "accessed_at": {"$gte": cutoff}
        })
        if dup:
            return  # skip – already logged recently

    entry = {
        "owner_id":      owner_id,
        "doc_id":        doc_id,
        "client_id":     str(client_id),
        "firebase_path": firebase_path,
        "filename":      filename,
        "type":          doc_type,
        "action":        action,
        "client_name":   client_name,
        "accessed_at":   now,
    }
    # Optional: capture request context (IP / User-Agent) when available
    try:
        entry["ip"]         = request.remote_addr or ""
        entry["user_agent"] = (request.headers.get("User-Agent") or "")[:200]
    except RuntimeError:
        pass  # called outside request context
    if extra and isinstance(extra, dict):
        entry.update(extra)
    db.activity.insert_one(entry)


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
            # ── Read raw bytes first so we can hash before doing any work ──────
            raw_bytes   = file.read()
            content_hash = hashlib.sha256(raw_bytes).hexdigest()

            # ── Filename-level duplicate (fast check) ─────────────────────────
            if db.clients.find_one({"owner_id": owner_id, "documents.filename": fname}):
                errors.append({"filename": fname, "error": "Already exists"})
                continue

            # ── Content-hash duplicate (catches same file, different name) ─────
            dup_client = db.clients.find_one({
                "owner_id":  owner_id,
                "documents": {"$elemMatch": {
                    "content_hash": content_hash,
                    "deleted_at":   {"$exists": False}
                }}
            })
            if dup_client:
                # Find the specific matching doc to give a helpful message
                dup_doc = next(
                    (d for d in dup_client.get("documents", [])
                     if d.get("content_hash") == content_hash and not d.get("deleted_at")),
                    None
                )
                if dup_doc and dup_doc.get("status") == "pending":
                    # Already stored but waiting for AI — just surface it
                    errors.append({
                        "filename": fname,
                        "error":    "Duplicate — already queued for AI processing",
                        "dup_doc_id": dup_doc.get("doc_id")
                    })
                else:
                    errors.append({
                        "filename": fname,
                        "error":    f"Duplicate — already stored in '{dup_client.get('name', 'unknown').replace('_', ' ')}'",
                        "dup_doc_id": (dup_doc or {}).get("doc_id")
                    })
                continue

            ai_bytes         = storage_engine.compress_to_webp_bytes(raw_bytes, fname, quality_override=85)

            # ── Classify doc type (27MB CPU model, ~25ms) — before calling LLM ───
            classifier_result = id_classifier.classify(ai_bytes) if id_classifier.available else None
            if classifier_result is not None and classifier_result["confidence"] < id_classifier.CONFIDENCE_THRESHOLD:
                print(
                    f"    ⚠️  Low classifier confidence ({classifier_result['confidence']:.2f}) for {fname} — using generic AI prompt"
                )
                classifier_result = None

            ai_data          = current_brain.analyze(ai_bytes, classifier_result=classifier_result)

            # ── Fallback: reject non-documents when classifier was unavailable ─────
            if ai_data.get("document_type") == "Not_A_Document":
                errors.append({"filename": fname, "error": "Not a KYC document — please upload ID cards only"})
                continue

            compressed_bytes = storage_engine.compress_to_webp_bytes(raw_bytes, fname)

            ai_method = ai_data.get("method", "lm_studio")

            # ── Always store the file regardless of AI state ──────────
            doc_id                    = str(uuid.uuid4())
            dek                       = kms_engine.get_or_create_dek(owner_id, db)
            firebase_path, stored_size = storage_engine.upload_encrypted(
                compressed_bytes,
                owner_id,
                doc_id,
                dek,
            )

            if ai_method == "ai_unreachable":
                # LM Studio was offline/crashed — park under Pending folder
                client     = _get_or_create_pending_folder(owner_id)
                match_type = "ai_unreachable"
                doc_status = "pending"
                detected_type = "Unsorted"
                needs_review  = True
            elif ai_method == "failed":
                # AI ran but couldn't extract data (bad image, JSON error, etc.)
                # Keep separate from true UNKNOWN_CLIENT so it can be retried
                client     = _get_or_create_pending_folder(owner_id)
                match_type = "ai_failed"
                doc_status = "failed"
                detected_type = "Unsorted"
                needs_review  = True
            else:
                # AI successfully processed — only now do we trust client_name
                detected_type = TYPE_MAP.get(
                    (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                    ai_data.get("document_type") or "Unsorted"
                )
                client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
                needs_review  = client.get("needs_review", False)
                doc_status    = "needs_review" if needs_review else "processed"

            doc_entry = {
                "doc_id":        doc_id,
                "filename":      fname,
                "content_hash":  content_hash,
                "type":          detected_type,
                "firebase_path": firebase_path,
                "needs_review":  needs_review,
                "status":        doc_status,
                "match_type":    match_type,
                "file_size":     stored_size,    # encrypted size — matches actual Firebase usage
                "uploaded_at":   datetime.datetime.now(),
                # Per-doc AI metadata (so frontend can display per-document)
                "client_name":     ai_data.get("client_name") or "",
                "date_of_birth":   ai_data.get("date_of_birth") or "",
                "pan_number":      ai_data.get("pan_number") or "",
                "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
                "voter_id_number": ai_data.get("voter_id_number") or "",
                "dl_number":       ai_data.get("dl_number") or "",
                "card_side":       ai_data.get("card_side", "front"),
            }
            db.clients.update_one({"_id": client["_id"]}, {"$push": {"documents": doc_entry}})
            log_activity(owner_id, doc_id, client["_id"], firebase_path, fname, detected_type, "upload", client_name=client["name"])

            print(f"✅ {fname} → {client['name']} / {detected_type} | match={match_type} | status={doc_status}")
            results.append({
                "filename":     fname,
                "client":       client["name"],
                "type":         detected_type,
                "match_type":   match_type,
                "needs_review": needs_review,
                "status":       doc_status,
                "doc_id":       doc_id
            })

        except Exception as e:
            print(f"❌ {fname}: {e}")
            errors.append({"filename": fname, "error": str(e)})

    status = 207 if errors and results else (400 if errors else 201)
    return jsonify({"processed": results, "failed": errors}), status


@app.route('/retry-pending', methods=['POST'])
@firebase_required
def retry_pending():
    """Re-run AI on all documents that are status=pending (ai_unreachable batch)."""
    owner_id = request.firebase_uid

    pending_folder = db.clients.find_one({"owner_id": owner_id, "name": "Unsorted_Pending"})
    if not pending_folder:
        return jsonify({"retried": 0, "message": "No pending documents"}), 200

    if not current_brain.is_alive() and not gemini_brain.available:
        return jsonify({"error": "AI engine is still offline and no Gemini fallback configured."}), 503

    pending_docs = [
        d for d in pending_folder.get("documents", [])
        if d.get("status") in ("pending", "failed") and not d.get("deleted_at")
    ]
    if not pending_docs:
        return jsonify({"retried": 0, "message": "No pending documents"}), 200

    retried, failed = 0, []
    dek = kms_engine.get_or_create_dek(owner_id, db)

    for doc in pending_docs:
        doc_id        = doc["doc_id"]
        firebase_path = doc["firebase_path"]
        fname         = doc["filename"]
        try:
            # Download the stored encrypted document
            img_bytes = storage_engine.download_decrypted(firebase_path, dek)

            # Re-classify for targeted extraction on retry
            classifier_result = id_classifier.classify(img_bytes) if id_classifier.available else None
            if classifier_result is not None and classifier_result["confidence"] < id_classifier.CONFIDENCE_THRESHOLD:
                print(
                    f"    ⚠️  Retry low classifier confidence ({classifier_result['confidence']:.2f}) for {fname} — using generic AI prompt"
                )
                classifier_result = None

            ai_data   = current_brain.analyze(img_bytes, classifier_result=classifier_result)

            if ai_data.get("method") == "ai_unreachable":
                # LM Studio still down — try Gemini as fallback before giving up
                if gemini_brain.available:
                    print(f"    🔄 LM Studio unreachable — trying Gemini fallback for {fname}")
                    ai_data = gemini_brain.analyze(img_bytes, classifier_result=classifier_result)
                if ai_data.get("method") == "ai_unreachable":
                    failed.append({"doc_id": doc_id, "error": "AI still unreachable"})
                    continue

            # If identified as not a document during retry, remove from pending cleanly
            if ai_data.get("document_type") == "Not_A_Document":
                db.clients.update_one(
                    {"_id": pending_folder["_id"]},
                    {"$pull": {"documents": {"doc_id": doc_id}}}
                )
                print(f"    🚫 Retry: '{fname}' is not a KYC document — removed from pending")
                retried += 1
                continue

            detected_type = TYPE_MAP.get(
                (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                ai_data.get("document_type") or "Unsorted"
            )
            client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
            needs_review       = client.get("needs_review", False)

            # Move doc to new client, remove from pending folder
            new_doc_entry = {**doc,
                "type":          detected_type,
                "needs_review":  needs_review,
                "status":        "needs_review" if needs_review else "processed",
                "match_type":    match_type,
                "client_name":     ai_data.get("client_name") or "",
                "date_of_birth":   ai_data.get("date_of_birth") or "",
                "pan_number":      ai_data.get("pan_number") or "",
                "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
                "voter_id_number": ai_data.get("voter_id_number") or "",
                "dl_number":       ai_data.get("dl_number") or "",
                "card_side":       ai_data.get("card_side", doc.get("card_side", "front")),
            }
            db.clients.update_one({"_id": client["_id"]},    {"$push": {"documents": new_doc_entry}})
            db.clients.update_one({"_id": pending_folder["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
            log_activity(owner_id, doc_id, client["_id"], firebase_path, fname, detected_type, "upload", client_name=client["name"])
            retried += 1
            print(f"    ✅ Retry OK: {fname} → {client['name']} / {detected_type}")

        except Exception as e:
            failed.append({"doc_id": doc_id, "error": str(e)})
            print(f"    ❌ Retry failed for {fname}: {e}")

    # Clean up the pending folder if it's now empty
    _cleanup_empty_client(pending_folder["_id"])

    return jsonify({"retried": retried, "failed": failed}), 200


@app.route('/clients', methods=['GET'])
@firebase_required
def get_clients():
    owner_id = request.firebase_uid
    clients  = list(db.clients.find({"owner_id": owner_id}, {"_id": 0, "owner_id": 0}))

    # Strip soft-deleted documents before returning
    for c in clients:
        c["documents"] = [d for d in c.get("documents", []) if not d.get("deleted_at")]

    # Remove clients with zero live documents
    clients = [c for c in clients if c.get("documents")]

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
        file_bytes = _download_smart(firebase_path, owner_id)
        log_activity(owner_id, doc["doc_id"], client["_id"], firebase_path, doc["filename"], doc["type"], "preview", client_name=client.get("name", ""))

        # Build ETag from content hash for browser-level caching
        etag = hashlib.md5(file_bytes).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip('" ')
        if if_none_match == etag:
            return "", 304

        response = make_response(send_file(io.BytesIO(file_bytes), mimetype='image/webp', as_attachment=False))
        response.headers["Cache-Control"] = "private, max-age=86400"   # 24 hours
        response.headers["ETag"] = f'"{etag}"'
        return response
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
        file_bytes = _download_smart(firebase_path, owner_id)
        dl_name    = f"{client['name']}_{doc['type']}"
        log_activity(owner_id, doc["doc_id"], client["_id"], firebase_path, doc["filename"], doc["type"], "download", client_name=client.get("name", ""))

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
                    raw = _download_smart(firebase_path, owner_id)
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

    doc = next((d for d in client["documents"] if d["firebase_path"] == firebase_path), None)
    try:
        storage_engine.delete_file(firebase_path)
        db.clients.update_one(
            {"_id": client["_id"]},
            {"$pull": {"documents": {"firebase_path": firebase_path}}}
        )
        if doc:
            log_activity(owner_id, doc.get("doc_id", ""), client["_id"], firebase_path,
                         doc.get("filename", ""), doc.get("type", ""), "delete", client_name=client.get("name", ""))
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
    pending_count = sum(
        1 for c in clients for d in c.get("documents", [])
        if d.get("status") in ("pending", "failed")
    )

    by_type = {}
    for c in clients:
        for d in c.get("documents", []):
            t = d.get("type", "Unsorted")
            by_type[t] = by_type.get(t, 0) + 1

    return jsonify({
        "total_files":     total_files,
        "total_clients":   len(clients),
        "needs_review":    needs_review,
        "pending_count":   pending_count,
        "by_type":         by_type,
        "storage_used_mb": round(total_bytes / (1024 * 1024), 3)
    }), 200


@app.route('/activity/recent', methods=['GET'])
@firebase_required
def recent_activity():
    owner_id  = request.firebase_uid
    limit     = int(request.args.get('limit', 50))
    action_f  = request.args.get('action', '').strip().lower()  # optional filter
    q = {"owner_id": owner_id}
    if action_f:
        q["action"] = action_f
    logs = list(db.activity.find(q, {"_id": 0, "owner_id": 0})
                .sort("accessed_at", -1).limit(limit))
    for log in logs:
        if hasattr(log.get("accessed_at"), "isoformat"):
            log["accessed_at"] = log["accessed_at"].isoformat()
    return jsonify({"recent": logs}), 200


@app.route('/activity/trail', methods=['GET'])
@firebase_required
def activity_trail():
    """Full audit trail for a specific document."""
    owner_id = request.firebase_uid
    doc_id   = request.args.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400
    logs = list(db.activity.find(
        {"owner_id": owner_id, "doc_id": doc_id},
        {"_id": 0, "owner_id": 0}
    ).sort("accessed_at", -1).limit(200))
    for log in logs:
        if hasattr(log.get("accessed_at"), "isoformat"):
            log["accessed_at"] = log["accessed_at"].isoformat()
    return jsonify({"trail": logs, "total": len(logs)}), 200


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
    """Re-run AI on a document and reassign it to the correct client if identity changes.

    After AI analysis the document may move from its current client record to a
    different (or newly created) one via find_or_create_client — exactly the same
    logic used on first upload.  The firebase_path is intentionally NOT changed
    (flat UUID path means the blob location is forever stable regardless of client).
    """
    owner_id = request.firebase_uid
    doc_id   = request.json.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    old_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not old_client:
        return jsonify({"error": "Document not found"}), 404

    doc = next((d for d in old_client["documents"] if d["doc_id"] == doc_id), None)
    if not doc:
        return jsonify({"error": "Document entry missing"}), 404

    try:
        file_bytes        = _download_smart(doc["firebase_path"], owner_id)
        classifier_result = id_classifier.classify(file_bytes) if id_classifier.available else None
        ai_data           = current_brain.analyze(file_bytes, classifier_result=classifier_result)

        if ai_data.get("method") == "ai_unreachable" and gemini_brain.available:
            print(f"    🔄 LM Studio unreachable — trying Gemini fallback for reanalyze {doc_id}")
            ai_data = gemini_brain.analyze(file_bytes, classifier_result=classifier_result)

        detected_type = TYPE_MAP.get(
            (ai_data.get("document_type") or "").upper().replace(" ", "_"),
            ai_data.get("document_type") or "Unsorted"
        )
        has_uid  = bool(ai_data.get("pan_number") or ai_data.get("aadhaar_last4") or
                        ai_data.get("voter_id_number") or ai_data.get("dl_number"))
        dob      = (ai_data.get("date_of_birth") or "").replace("/", "").replace("-", "")

        # Determine the correct client (may differ from current)
        new_client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
        is_unknown     = (new_client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES
        has_strong_uid = bool(ai_data.get("pan_number") or ai_data.get("voter_id_number") or ai_data.get("dl_number"))
        a_last4_val    = ai_data.get("aadhaar_last4") or ""
        client_name    = (new_client.get("name") or "").upper()
        confident      = has_strong_uid or (client_name and dob) or (client_name and a_last4_val)
        needs_review   = is_unknown or not confident

        same_client = str(old_client["_id"]) == str(new_client["_id"])

        # Build per-doc metadata from AI results
        doc_meta = {
            "documents.$.type":            detected_type,
            "documents.$.needs_review":    needs_review,
            "documents.$.match_type":      match_type,
            "documents.$.client_name":     ai_data.get("client_name") or "",
            "documents.$.date_of_birth":   ai_data.get("date_of_birth") or "",
            "documents.$.pan_number":      ai_data.get("pan_number") or "",
            "documents.$.aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
            "documents.$.voter_id_number": ai_data.get("voter_id_number") or "",
            "documents.$.dl_number":       ai_data.get("dl_number") or "",
            "documents.$.card_side":       ai_data.get("card_side", doc.get("card_side", "front")),
        }

        if same_client:
            # Update doc fields + per-doc metadata in place
            db.clients.update_one(
                {"_id": old_client["_id"], "documents.doc_id": doc_id},
                {"$set": doc_meta}
            )
        else:
            # Move document entry: pull from old client, push into new client
            updated_doc = {
                **doc,
                "type":            detected_type,
                "needs_review":    needs_review,
                "match_type":      match_type,
                "client_name":     ai_data.get("client_name") or "",
                "date_of_birth":   ai_data.get("date_of_birth") or "",
                "pan_number":      ai_data.get("pan_number") or "",
                "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
                "voter_id_number": ai_data.get("voter_id_number") or "",
                "dl_number":       ai_data.get("dl_number") or "",
                "card_side":       ai_data.get("card_side", doc.get("card_side", "front")),
            }
            db.clients.update_one(
                {"_id": old_client["_id"]},
                {"$pull": {"documents": {"doc_id": doc_id}}}
            )
            db.clients.update_one(
                {"_id": new_client["_id"]},
                {"$push": {"documents": updated_doc}}
            )
            # Re-evaluate old client's needs_review flag
            refreshed_old = db.clients.find_one({"_id": old_client["_id"]})
            if refreshed_old and not any(d.get("needs_review") for d in refreshed_old.get("documents", [])):
                db.clients.update_one({"_id": old_client["_id"]}, {"$set": {"needs_review": False}})
            # Delete old client if now empty
            _cleanup_empty_client(old_client["_id"])
            print(f"    🔀 Reassigned {doc_id} from {old_client['name']} → {new_client['name']}")

        # Re-evaluate new client's needs_review flag
        if not is_unknown:
            refreshed_new = db.clients.find_one({"_id": new_client["_id"]})
            if refreshed_new and not any(d.get("needs_review") for d in refreshed_new.get("documents", [])):
                db.clients.update_one({"_id": new_client["_id"]}, {"$set": {"needs_review": False}})

        return jsonify({
            "message":      "Reanalyzed",
            "doc_id":       doc_id,
            "new_type":     detected_type,
            "needs_review": needs_review,
            "new_client":   new_client["name"],
            "reassigned":   not same_client,
            "ai_data":      ai_data,
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
    log_activity(owner_id, doc_id, client["_id"], doc.get("firebase_path", ""),
                 doc.get("filename", ""), doc.get("type", ""),
                 "star" if new_val else "unstar", client_name=client.get("name", ""))
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
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": datetime.datetime.now(),
                  "documents.$.starred":    False}}
    )
    if doc:
        log_activity(owner_id, doc_id, client["_id"], doc.get("firebase_path", ""),
                     doc.get("filename", ""), doc.get("type", ""), "trash", client_name=client.get("name", ""))
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
    doc = next((d for d in client["documents"] if d["doc_id"] == doc_id), None)
    db.clients.update_one(
        {"_id": client["_id"], "documents.doc_id": doc_id},
        {"$set": {"documents.$.deleted_at": None}}
    )
    if doc:
        log_activity(owner_id, doc_id, client["_id"], doc.get("firebase_path", ""),
                     doc.get("filename", ""), doc.get("type", ""), "restore", client_name=client.get("name", ""))
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
    """Update client-level identity fields + doc type.

    If the submitted name/DOB/UID now matches a *different* client than the
    current one the document is moved between MongoDB client records (no Firebase
    operation needed — paths are flat UUIDs).
    """
    owner_id = request.firebase_uid
    data     = request.json
    doc_id   = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    old_client = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
    if not old_client:
        return jsonify({"error": "Not found"}), 404

    doc = next((d for d in old_client["documents"] if d["doc_id"] == doc_id), None)
    if not doc:
        return jsonify({"error": "Document entry missing"}), 404

    # ── Build the ai_data-shaped dict from submitted fields ──
    ai_data = {}
    for field in ("name", "dob", "pan_number", "aadhaar_last4", "voter_id_number", "dl_number"):
        val = data.get(field)
        if val is not None:
            ai_data[field] = val.strip() if isinstance(val, str) else val
    # find_or_create_client reads "client_name", frontend sends "name"
    if "name" in ai_data:
        ai_data["client_name"] = ai_data["name"]

    # Carry the document_type through so find_or_create_client sees it
    submitted_type = data.get('type') or doc.get('type') or 'Unsorted'
    ai_data["document_type"] = next(
        (k for k, v in TYPE_MAP.items() if v == submitted_type),
        submitted_type
    )

    # ── Find/create the correct client based on the submitted identity ──
    new_client, match_type = find_or_create_client(owner_id, ai_data, submitted_type)

    # Normalise name in ai_data so it is stored as NAME_ONLY (upper + underscored)
    submitted_name = (ai_data.get("name") or "").strip().replace(" ", "_").upper()
    new_name_upper = (new_client.get("name") or "").upper()
    is_unknown     = new_name_upper in UNKNOWN_CLIENT_NAMES

    pan    = (ai_data.get("pan_number")      or new_client.get("pan_number")      or "").strip()
    a_last4 = (ai_data.get("aadhaar_last4")  or new_client.get("aadhaar_last4")   or "").strip()
    voter   = (ai_data.get("voter_id_number") or new_client.get("voter_id_number") or "").strip()
    dl      = (ai_data.get("dl_number")       or new_client.get("dl_number")       or "").strip()
    dob     = (ai_data.get("dob")             or new_client.get("dob")             or "").replace("/", "").replace("-", "")
    has_uid = bool(pan or a_last4 or voter or dl)
    needs_review = is_unknown or not (dob and has_uid)

    same_client = str(old_client["_id"]) == str(new_client["_id"])

    if same_client:
        # Only type/needs_review change; also update client-level fields in place
        doc_updates = {"documents.$.needs_review": needs_review}
        if data.get('type'):
            doc_updates["documents.$.type"] = submitted_type
        db.clients.update_one(
            {"_id": old_client["_id"], "documents.doc_id": doc_id},
            {"$set": doc_updates}
        )
        _update_client_fields(old_client["_id"], ai_data)
    else:
        # Move document entry to new client
        updated_doc = {**doc, "type": submitted_type, "needs_review": needs_review, "match_type": match_type}
        db.clients.update_one(
            {"_id": old_client["_id"]},
            {"$pull": {"documents": {"doc_id": doc_id}}}
        )
        db.clients.update_one(
            {"_id": new_client["_id"]},
            {"$push": {"documents": updated_doc}}
        )
        # Re-evaluate old client's review flag
        refreshed_old = db.clients.find_one({"_id": old_client["_id"]})
        if refreshed_old and not any(d.get("needs_review") for d in refreshed_old.get("documents", [])):
            db.clients.update_one({"_id": old_client["_id"]}, {"$set": {"needs_review": False}})
        # Delete old client if now empty
        _cleanup_empty_client(old_client["_id"])
        print(f"    🔀 Metadata save reassigned {doc_id}: {old_client['name']} → {new_client['name']}")

    # Re-evaluate new client's review flag
    if not is_unknown:
        refreshed_new = db.clients.find_one({"_id": new_client["_id"]})
        if refreshed_new and not any(d.get("needs_review") for d in refreshed_new.get("documents", [])):
            db.clients.update_one({"_id": new_client["_id"]}, {"$set": {"needs_review": False}})

    return jsonify({
        "message":    "Metadata updated",
        "doc_id":     doc_id,
        "new_client": new_client["name"],
        "reassigned": not same_client,
    }), 200


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
                file_bytes    = _download_smart(doc["firebase_path"], owner_id)
                ai_data       = current_brain.analyze(file_bytes)
                detected_type = TYPE_MAP.get(
                    (ai_data.get("document_type") or "").upper().replace(" ", "_"),
                    ai_data.get("document_type") or "Unsorted"
                )
                has_uid  = bool(ai_data.get("pan_number") or ai_data.get("aadhaar_last4") or
                                ai_data.get("voter_id_number") or ai_data.get("dl_number"))
                dob      = (ai_data.get("date_of_birth") or "").replace("/", "").replace("-", "")

                new_client, match_type = find_or_create_client(owner_id, ai_data, detected_type)
                is_unknown     = (new_client.get("name") or "").upper() in UNKNOWN_CLIENT_NAMES
                has_strong_uid = bool(ai_data.get("pan_number") or ai_data.get("voter_id_number") or ai_data.get("dl_number"))
                a_last4_val    = ai_data.get("aadhaar_last4") or ""
                client_name    = (new_client.get("name") or "").upper()
                confident      = has_strong_uid or (client_name and dob) or (client_name and a_last4_val)
                needs_review   = is_unknown or not confident

                same_client = str(client["_id"]) == str(new_client["_id"])
                bulk_doc_meta = {
                    "documents.$.type":            detected_type,
                    "documents.$.needs_review":    needs_review,
                    "documents.$.match_type":      match_type,
                    "documents.$.client_name":     ai_data.get("client_name") or "",
                    "documents.$.date_of_birth":   ai_data.get("date_of_birth") or "",
                    "documents.$.pan_number":      ai_data.get("pan_number") or "",
                    "documents.$.aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
                    "documents.$.voter_id_number": ai_data.get("voter_id_number") or "",
                    "documents.$.dl_number":       ai_data.get("dl_number") or "",
                }
                if same_client:
                    db.clients.update_one(
                        {"_id": client["_id"], "documents.doc_id": doc_id},
                        {"$set": bulk_doc_meta}
                    )
                    _update_client_fields(client["_id"], ai_data)
                else:
                    updated_doc = {
                        **doc,
                        "type":            detected_type,
                        "needs_review":    needs_review,
                        "match_type":      match_type,
                        "client_name":     ai_data.get("client_name") or "",
                        "date_of_birth":   ai_data.get("date_of_birth") or "",
                        "pan_number":      ai_data.get("pan_number") or "",
                        "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
                        "voter_id_number": ai_data.get("voter_id_number") or "",
                        "dl_number":       ai_data.get("dl_number") or "",
                    }
                    db.clients.update_one({"_id": client["_id"]}, {"$pull": {"documents": {"doc_id": doc_id}}})
                    db.clients.update_one({"_id": new_client["_id"]}, {"$push": {"documents": updated_doc}})
                    refreshed_old = db.clients.find_one({"_id": client["_id"]})
                    if refreshed_old and not any(d.get("needs_review") for d in refreshed_old.get("documents", [])):
                        db.clients.update_one({"_id": client["_id"]}, {"$set": {"needs_review": False}})
                    _cleanup_empty_client(client["_id"])

                if not is_unknown:
                    refreshed_new = db.clients.find_one({"_id": new_client["_id"]})
                    if refreshed_new and not any(d.get("needs_review") for d in refreshed_new.get("documents", [])):
                        db.clients.update_one({"_id": new_client["_id"]}, {"$set": {"needs_review": False}})
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


# ------------------------------------------------------------------ #
#  SHARED CONTENT ACCESS ROUTES                                       #
#  These let a user preview/download content shared with them.        #
#  The owner's DEK is used for decryption — NOT the requester's.      #
# ------------------------------------------------------------------ #

def _resolve_shared_doc(requester_uid, requester_email, doc_id):
    """Return (share_record, owner_id, client_record, doc_entry) or None-tuple."""
    email = requester_email.lower()

    # Check: is there a direct document share?
    share = db.shares.find_one({
        "resource_type": "document",
        "resource_id":   doc_id,
        "$or": [{"shared_with_uid": requester_uid}, {"shared_with_email": email}],
    })

    if share:
        owner_id   = share["owner_id"]
        client_rec = db.clients.find_one({"owner_id": owner_id, "documents.doc_id": doc_id})
        if client_rec:
            doc = next((d for d in client_rec["documents"] if d["doc_id"] == doc_id), None)
            if doc:
                return share, owner_id, client_rec, doc

    # Check: is there a client-level share that covers this doc?
    client_rec = db.clients.find_one({"documents.doc_id": doc_id})
    if client_rec:
        client_name = client_rec.get("name")
        owner_id    = client_rec["owner_id"]
        share = db.shares.find_one({
            "owner_id":      owner_id,
            "resource_type": "client",
            "resource_id":   client_name,
            "$or": [{"shared_with_uid": requester_uid}, {"shared_with_email": email}],
        })
        if share:
            doc = next((d for d in client_rec["documents"] if d["doc_id"] == doc_id), None)
            if doc:
                return share, owner_id, client_rec, doc

    return None, None, None, None


@app.route('/shared/preview', methods=['GET'])
@firebase_required
def shared_preview():
    """Preview a shared document (viewer or editor)."""
    doc_id = request.args.get('doc_id')
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    share, owner_id, client_rec, doc = _resolve_shared_doc(
        request.firebase_uid, request.firebase_email, doc_id
    )
    if not share:
        return jsonify({"error": "Not shared with you or not found"}), 403

    try:
        file_bytes = _download_smart(doc["firebase_path"], owner_id)

        etag = hashlib.md5(file_bytes).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip('" ')
        if if_none_match == etag:
            return "", 304

        response = make_response(send_file(io.BytesIO(file_bytes), mimetype='image/webp', as_attachment=False))
        response.headers["Cache-Control"] = "private, max-age=86400"
        response.headers["ETag"] = f'"{etag}"'
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/shared/download', methods=['GET'])
@firebase_required
def shared_download():
    """Download a shared document (editor permission required)."""
    doc_id     = request.args.get('doc_id')
    out_format = request.args.get('format', 'jpg').lower()
    rotation   = int(request.args.get('rotation', 0)) % 360

    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    share, owner_id, client_rec, doc = _resolve_shared_doc(
        request.firebase_uid, request.firebase_email, doc_id
    )
    if not share:
        return jsonify({"error": "Not shared with you or not found"}), 403
    if share["permission"] != "editor":
        return jsonify({"error": "Download requires editor permission"}), 403

    try:
        file_bytes = _download_smart(doc["firebase_path"], owner_id)
        dl_name    = f"{client_rec['name']}_{doc['type']}"

        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        if rotation:
            img = img.rotate(-rotation, expand=True)

        if out_format == 'jpg':
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=95)
            buf.seek(0)
            return send_file(buf, mimetype='image/jpeg', as_attachment=True, download_name=f"{dl_name}.jpg")
        elif out_format == 'pdf':
            buf = io.BytesIO()
            img.save(buf, 'PDF')
            buf.seek(0)
            return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=f"{dl_name}.pdf")
        else:
            return jsonify({"error": "Use jpg or pdf"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/shared/client-docs', methods=['GET'])
@firebase_required
def shared_client_docs():
    """Get all documents in a shared client folder."""
    share_id = request.args.get('share_id')
    if not share_id:
        return jsonify({"error": "Missing share_id"}), 400

    from bson import ObjectId
    try:
        oid = ObjectId(share_id)
    except Exception:
        return jsonify({"error": "Invalid share_id"}), 400

    uid   = request.firebase_uid
    email = request.firebase_email.lower()

    share = db.shares.find_one({
        "_id": oid,
        "$or": [{"shared_with_uid": uid}, {"shared_with_email": email}],
    })
    if not share or share["resource_type"] != "client":
        return jsonify({"error": "Share not found"}), 404

    client_rec = db.clients.find_one({
        "owner_id": share["owner_id"],
        "name":     share["resource_id"],
    })
    if not client_rec:
        return jsonify({"error": "Client folder no longer exists"}), 404

    docs = [d for d in client_rec.get("documents", []) if not d.get("deleted_at")]
    # Serialise datetime fields
    for d in docs:
        if hasattr(d.get("uploaded_at"), "strftime"):
            d["uploaded_at"] = d["uploaded_at"].strftime("%Y-%m-%d %H:%M:%S")

    return jsonify({
        "client_name": client_rec["name"],
        "permission":  share["permission"],
        "owner_name":  share.get("owner_name", ""),
        "documents":   docs,
    }), 200


if __name__ == '__main__':
    app.run(debug=True, port=8000)
