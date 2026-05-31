import datetime
import hashlib
from auth import db
from services.pii_crypto import encrypt_client_pii, decrypt_client_pii, _hash_pii


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


def _create_client(owner_id, name, dob, ai_data, needs_review=False, force_folder=None):
    folder_name = force_folder or (f"{name}_{dob}" if dob else name)
    folder_path = f"{owner_id}/{folder_name}"

    # Encrypt sensitive PII fields, keep plaintext ones as-is
    pii_encrypted = encrypt_client_pii(owner_id, ai_data)

    client = {
        "owner_id":        owner_id,
        "name":            name,
        "dob":             dob,
        "aadhaar_last4":   ai_data.get("aadhaar_last4") or "",
        "folder_path":     folder_path,
        "documents":       [],
        "needs_review":    needs_review,
        "created_at":      datetime.datetime.now()
    }

    # Apply encrypted PII fields (pan_number_hash, pan_number_enc, etc.)
    client.update(pii_encrypted)

    result = db.clients.insert_one(client)
    client["_id"] = result.inserted_id
    return client


def _update_client_fields(client_id, ai_data):
    # Need owner_id from the client doc to derive DEK
    client_doc = db.clients.find_one({"_id": client_id}, {"owner_id": 1})
    if not client_doc:
        return
    owner_id = client_doc.get("owner_id")
    if not owner_id:
        return

    updates = {}
    a_last4 = ai_data.get("aadhaar_last4") or ""
    dob = ai_data.get("date_of_birth") or ""

    # Build ai_data with owner_id for encryption
    pii_updates = encrypt_client_pii(owner_id, ai_data)
    updates.update(pii_updates)

    # Also handle aliases (ai_data may use 'date_of_birth' vs 'dob')
    if "dob" not in updates and dob:
        updates["dob"] = dob
    if "aadhaar_last4" not in updates and a_last4:
        updates["aadhaar_last4"] = a_last4

    if updates:
        db.clients.update_one({"_id": client_id}, {"$set": updates})


def _get_or_create_pending_folder(owner_id):
    existing = db.clients.find_one({"owner_id": owner_id, "name": "Unsorted_Pending"})
    if existing:
        return existing
    folder_path = f"{owner_id}/Unsorted_Pending"
    client = {
        "owner_id":        owner_id,
        "name":            "Unsorted_Pending",
        "dob":             "",
        "aadhaar_last4":   "",
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
    client = db.clients.find_one({"_id": client_id})
    if not client:
        return
    live_docs = [d for d in client.get("documents", []) if not d.get("deleted_at")]
    if len(live_docs) == 0:
        db.clients.delete_one({"_id": client_id})
        print(f"    🗑️  Deleted empty client folder: {client.get('name')}")


def find_or_create_client(owner_id, ai_data, detected_type):
    name = " ".join((ai_data.get("client_name") or "").strip().split()).replace(" ", "_").upper()
    dob = (ai_data.get("date_of_birth") or "").strip()
    dob = dob.replace("/", "").replace("-", "")
    pan = (ai_data.get("pan_number") or "").strip().upper()
    a_last4 = (ai_data.get("aadhaar_last4") or "").strip()
    voter_id = (ai_data.get("voter_id_number") or "").strip().upper()
    dl = (ai_data.get("dl_number") or "").strip().upper()

    # Use hashed PII values for MongoDB queries (SHA-256, deterministic)
    pan_hash = _hash_pii(pan) if pan else ""
    voter_id_hash = _hash_pii(voter_id) if voter_id else ""
    dl_hash = _hash_pii(dl) if dl else ""

    _not_unknown = {"name": {"$nin": list(UNKNOWN_CLIENT_NAMES)}}

    uid_query = None
    if pan_hash:
        uid_query = {"owner_id": owner_id, "pan_number_hash": pan_hash, **_not_unknown}
    elif a_last4 and dob:
        uid_query = {"owner_id": owner_id, "aadhaar_last4": a_last4, "dob": dob, **_not_unknown}
    elif voter_id_hash:
        uid_query = {"owner_id": owner_id, "voter_id_number_hash": voter_id_hash, **_not_unknown}
    elif dl_hash:
        uid_query = {"owner_id": owner_id, "dl_number_hash": dl_hash, **_not_unknown}

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
        has_strong_uid = bool(pan or voter_id or dl)
        confident = has_strong_uid or (bool(name) and bool(dob)) or (bool(name) and bool(a_last4))
        client = _create_client(owner_id, name, dob, ai_data, needs_review=not confident)
        print(f"    🆕 New provisional client → {name}")
        return client, "name_only_new"

    existing = db.clients.find_one({"owner_id": owner_id, "name": "UNKNOWN_CLIENT"})
    if existing:
        print(f"    ❌ No match — appended to shared UNKNOWN_CLIENT")
        return existing, "no_match"

    client = _create_client(owner_id, "UNKNOWN_CLIENT", "", ai_data, needs_review=True, force_folder="UNKNOWN_CLIENT")
    print(f"    ❌ No match — created shared UNKNOWN_CLIENT")
    return client, "no_match"
