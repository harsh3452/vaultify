"""
One-time migration script for Vaultify MongoDB data.
Run: python migrate_unknown.py

What it does:
  1. Merges all fragmented UNKNOWN / NA / UNKNOWN_NAME client records
     per owner into a single canonical UNKNOWN_CLIENT bucket.
  2. Adds starred=False and deleted_at=None to every document that is
     missing those fields (needed for the starred/trash features).
  3. Encrypts all legacy unencrypted Firebase blobs (.webp → .webp.enc)
     using each user's KMS-wrapped DEK, then updates the firebase_path
     in MongoDB to the new .enc path.
"""

import os
import datetime
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

mongo_client = MongoClient(os.getenv("MONGO_URI"))
db = mongo_client.vaultify_db

UNKNOWN_CLIENT_NAMES = {
    "", "UNKNOWN", "UNKNOWN_CLIENT", "UNKNOWN_NAME", "NA", "N/A", "NONE",
    "NOT_AVAILABLE", "NOT_FOUND", "UNIDENTIFIED"
}


def migrate_unknown_clients():
    owners = db.clients.distinct("owner_id")
    total_merged = 0

    for owner_id in owners:
        unknowns = list(db.clients.find({
            "owner_id": owner_id,
            "name":     {"$in": list(UNKNOWN_CLIENT_NAMES)}
        }))

        if not unknowns:
            continue

        # Pick the canonical record (prefer one named UNKNOWN_CLIENT, else first)
        canonical = next((u for u in unknowns if u["name"] == "UNKNOWN_CLIENT"), unknowns[0])
        others    = [u for u in unknowns if str(u["_id"]) != str(canonical["_id"])]

        if not others:
            # Just ensure the name is UNKNOWN_CLIENT
            db.clients.update_one(
                {"_id": canonical["_id"]},
                {"$set": {"name": "UNKNOWN_CLIENT", "needs_review": True}}
            )
            continue

        # Merge all docs from other records into canonical
        merged_docs = list(canonical.get("documents", []))
        for other in others:
            merged_docs.extend(other.get("documents", []))
            db.clients.delete_one({"_id": other["_id"]})
            print(f"  Deleted duplicate unknown client {other.get('name')} ({other['_id']}) for owner {owner_id[:8]}...")

        db.clients.update_one(
            {"_id": canonical["_id"]},
            {"$set": {
                "name":         "UNKNOWN_CLIENT",
                "documents":    merged_docs,
                "needs_review": True,
                "folder_path":  f"{owner_id}/UNKNOWN_CLIENT"
            }}
        )
        total_merged += len(others)
        print(f"  Merged {len(others)} unknown record(s) into canonical UNKNOWN_CLIENT for owner {owner_id[:8]}...")

    print(f"\n✅  Unknown client merge complete — {total_merged} duplicate record(s) removed.")


def backfill_document_fields():
    """Add starred and deleted_at to every doc sub-document that lacks them."""
    clients = list(db.clients.find({}))
    updated = 0

    for c in clients:
        docs     = c.get("documents", [])
        modified = False
        for doc in docs:
            if "starred" not in doc:
                doc["starred"] = False
                modified = True
            if "deleted_at" not in doc:
                doc["deleted_at"] = None
                modified = True
        if modified:
            db.clients.update_one({"_id": c["_id"]}, {"$set": {"documents": docs}})
            updated += 1

    print(f"✅  Backfilled starred/deleted_at on {updated} client record(s).")


def encrypt_legacy_files():
    """Encrypt all unencrypted Firebase blobs for every user.

    For each document whose firebase_path does NOT end in '.enc':
      1. Download the raw bytes from Firebase.
      2. Fetch (or create) the user's DEK via KMS.
      3. Re-upload as '{user_id}/docs/{doc_id}.webp.enc'.
      4. Delete the old unencrypted blob.
      5. Update firebase_path in MongoDB.
    """
    from storage_manager import storage_engine
    from kms_manager import kms_engine

    owners = db.clients.distinct("owner_id")
    total_encrypted = 0
    total_errors    = 0

    for owner_id in owners:
        # Fetch DEK once per user (one KMS call)
        try:
            dek = kms_engine.get_or_create_dek(owner_id, db)
        except Exception as e:
            print(f"  ⚠️  Cannot get DEK for {owner_id[:8]}…: {e} — skipping user")
            total_errors += 1
            continue

        clients = list(db.clients.find({"owner_id": owner_id}))
        for client in clients:
            docs     = client.get("documents", [])
            modified = False
            for doc in docs:
                old_path = doc.get("firebase_path", "")
                if not old_path or old_path.endswith(".enc"):
                    continue   # already encrypted or no path

                # Derive new path — same UUID, new extension
                new_path = old_path if old_path.endswith(".webp.enc") else old_path.rstrip(".webp") + ".webp.enc"
                # Safer: just append .enc
                new_path = old_path + ".enc"

                try:
                    raw_bytes  = storage_engine.download_as_bytes(old_path)
                    ciphertext = kms_engine.encrypt_bytes(dek, raw_bytes)

                    new_blob = storage_engine.bucket.blob(new_path)
                    new_blob.upload_from_string(ciphertext, content_type="application/octet-stream")

                    # Delete old unencrypted blob
                    storage_engine.bucket.blob(old_path).delete()

                    doc["firebase_path"] = new_path
                    modified = True
                    total_encrypted += 1
                    print(f"  🔒 {old_path} → {new_path}")

                except Exception as e:
                    print(f"  ❌  Failed to encrypt {old_path}: {e}")
                    total_errors += 1

            if modified:
                db.clients.update_one({"_id": client["_id"]}, {"$set": {"documents": docs}})

    print(f"\n✅  Legacy encryption complete — {total_encrypted} file(s) encrypted, {total_errors} error(s).")


if __name__ == "__main__":
    print("=== Vaultify DB Migration ===\n")
    print("1. Merging fragmented unknown clients...")
    migrate_unknown_clients()
    print("\n2. Backfilling starred / deleted_at fields...")
    backfill_document_fields()
    print("\n3. Encrypting legacy unencrypted Firebase files...")
    encrypt_legacy_files()
    print("\n=== Done ===")
