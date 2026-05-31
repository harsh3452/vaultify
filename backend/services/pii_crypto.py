"""
PII encryption/decryption helpers for sensitive client fields.

Uses the same KMS-envelope scheme as GDrive tokens:
  - Hash for searchability (SHA-256, deterministic)
  - Fernet encryption for storage (random IV each time)
"""

import hashlib
import base64
from kms_manager import kms_engine
from auth import db

# Fields that get encrypted (hash + enc)
PII_ENCRYPTED_FIELDS = {
    "pan_number",
    "voter_id_number",
    "dl_number",
}

# Aadhaar last-4 stays in plaintext (as specified)
PII_PLAINTEXT_FIELDS = {
    "aadhaar_last4",
    "dob",
    "name",
}


def _hash_pii(value: str) -> str:
    """Deterministic hash for MongoDB queries."""
    if not value:
        return ""
    return hashlib.sha256(value.strip().upper().encode("utf-8")).hexdigest()


def _encrypt_pii(owner_id: str, value: str) -> str | None:
    """Encrypt a PII value with the user's DEK.

    Returns url-safe base64 encoded ciphertext, or None if value is empty.
    """
    if not value:
        return None
    dek = kms_engine.get_or_create_dek(owner_id, db)
    encrypted = kms_engine.encrypt_bytes(dek, value.strip().upper().encode("utf-8"))
    return base64.urlsafe_b64encode(encrypted).decode("ascii")


def _decrypt_pii(owner_id: str, enc_value: str) -> str | None:
    """Decrypt a PII value with the user's DEK.

    Returns plaintext string, or None if enc_value is empty/None.
    """
    if not enc_value:
        return None
    try:
        dek = kms_engine.get_or_create_dek(owner_id, db)
        encrypted = base64.urlsafe_b64decode(enc_value.encode("ascii"))
        decrypted = kms_engine.decrypt_bytes(dek, encrypted)
        return decrypted.decode("utf-8")
    except Exception:
        return None


def encrypt_client_pii(owner_id: str, ai_data: dict) -> dict:
    """Build a set of updates for encrypted PII fields from raw AI data.

    Returns dict with both '_hash' and '_enc' fields for each encrypted PII field,
    plus any plaintext fields passed through unchanged.

    Example output:
    {
        "pan_number_hash": "abc123...",
        "pan_number_enc": "base64cipher...",
        "voter_id_number_hash": "def456...",
        "voter_id_number_enc": "base64cipher...",
        "aadhaar_last4": "1234",    # plaintext
    }
    """
    updates = {}

    for field in PII_ENCRYPTED_FIELDS:
        raw_value = (ai_data.get(field) or "").strip()
        if raw_value:
            updates[f"{field}_hash"] = _hash_pii(raw_value)
            updates[f"{field}_enc"] = _encrypt_pii(owner_id, raw_value)

    # Plaintext fields pass through as-is
    for field in PII_PLAINTEXT_FIELDS:
        val = ai_data.get(field)
        if val is not None:
            updates[field] = val.strip() if isinstance(val, str) else val

    return updates


def decrypt_client_pii(owner_id: str, client_doc: dict) -> dict:
    """Return a copy of the client doc with PII fields decrypted in-place.

    Reads `_enc` fields, decrypts them, and writes the plaintext back
    under the original field name (e.g. `pan_number`).
    Legacy plaintext fields are passed through unchanged.
    """
    if not client_doc:
        return client_doc

    doc = dict(client_doc)

    for field in PII_ENCRYPTED_FIELDS:
        enc_key = f"{field}_enc"
        legacy_key = field

        if doc.get(enc_key):
            # New format — decrypt
            plain = _decrypt_pii(owner_id, doc[enc_key])
            if plain is not None:
                doc[legacy_key] = plain
            # Remove the _enc and _hash keys from the output (keep them internal)
            doc.pop(enc_key, None)
            doc.pop(f"{field}_hash", None)
        elif doc.get(legacy_key):
            # Legacy plaintext — leave as-is, hash it for searchability
            pass  # keep legacy_key value in doc

    return doc