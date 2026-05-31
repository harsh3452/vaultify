"""
One-time migration script to encrypt any plaintext Google Drive tokens
still stored in the database and remove the legacy plaintext fields.

Run this once after deploying the code changes that remove plaintext fallback reads.

Usage:
    cd backend && python -m scripts.migrate_legacy_gdrive_tokens
"""

import base64
import sys
import os

# Add parent dir to path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pymongo import MongoClient
from kms_manager import kms_engine

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    print("❌ MONGO_URI not set in .env")
    sys.exit(1)

client = MongoClient(MONGO_URI)
db = client.vaultify_db


def _encrypt_token(owner_id, token):
    """Encrypt a plaintext token with the user's DEK (same logic as auth.py)."""
    if not token:
        return None
    dek = kms_engine.get_or_create_dek(owner_id, db)
    encrypted = kms_engine.encrypt_bytes(dek, token.encode("utf-8"))
    return base64.urlsafe_b64encode(encrypted).decode("ascii")


def main():
    print("🔍 Scanning for users with legacy plaintext Google Drive tokens...")

    # Find users who have plaintext tokens but are missing the encrypted versions
    cursor = db.users.find({
        "$or": [
            {"gdrive_refresh_token": {"$exists": True, "$ne": ""}},
            {"gdrive_access_token": {"$exists": True, "$ne": ""}},
        ]
    })

    migrated = 0
    skipped = 0

    for user in cursor:
        uid = user.get("uid")
        if not uid:
            skipped += 1
            continue

        refresh_plain = user.get("gdrive_refresh_token") or ""
        access_plain = user.get("gdrive_access_token") or ""
        refresh_enc_existing = user.get("gdrive_refresh_token_enc") or ""
        access_enc_existing = user.get("gdrive_access_token_enc") or ""

        updates = {}
        unset_fields = {}

        # Migrate refresh token if plaintext exists and no encrypted version
        if refresh_plain and not refresh_enc_existing:
            enc = _encrypt_token(uid, refresh_plain)
            if enc:
                updates["gdrive_refresh_token_enc"] = enc
                print(f"  ✅ {uid[:8]}…: Encrypted refresh_token")

        # Migrate access token if plaintext exists and no encrypted version
        if access_plain and not access_enc_existing:
            enc = _encrypt_token(uid, access_plain)
            if enc:
                updates["gdrive_access_token_enc"] = enc
                print(f"  ✅ {uid[:8]}…: Encrypted access_token")

        # Always unset legacy plaintext fields (they'll be empty or migrated)
        unset_fields["gdrive_refresh_token"] = ""
        unset_fields["gdrive_access_token"] = ""

        if updates:
            db.users.update_one(
                {"uid": uid},
                {"$set": updates, "$unset": unset_fields}
            )
            migrated += 1
            print(f"  📦 {uid[:8]}…: Updated {list(updates.keys())}")
        else:
            # No tokens to migrate — just clean up empty plaintext fields
            db.users.update_one(
                {"uid": uid},
                {"$unset": unset_fields}
            )

    total = db.users.count_documents({})
    print(f"\n{'='*50}")
    print(f"Migration complete.")
    print(f"  Total users in DB:  {total}")
    print(f"  Users migrated:     {migrated}")
    print(f"  Users skipped:      {skipped}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()