# """
# Run once: python migrate_file_sizes.py
# Fetches file size from Firebase for all docs missing file_size_bytes
# and updates MongoDB.
# """

# from storage_manager import storage_engine
# from auth import db

# def migrate():
#     # Find all docs missing the field
#     docs = list(db.documents.find({"file_size_bytes": {"$exists": False}}))
    
#     print(f"Found {len(docs)} docs to migrate.")
    
#     success, failed = 0, 0

#     for doc in docs:
#         path = doc.get("firebase_path")
#         try:
#             blob = storage_engine.bucket.blob(path)
#             blob.reload()  # one-time Firebase call
#             size = blob.size or 0

#             db.documents.update_one(
#                 {"_id": doc["_id"]},
#                 {"$set": {"file_size_bytes": size}}
#             )
#             print(f"✅ {path} → {size} bytes")
#             success += 1

#         except Exception as e:
#             print(f"❌ Failed: {path} → {e}")
#             failed += 1

#     print(f"\nDone. {success} updated, {failed} failed.")

# if __name__ == "__main__":
#     migrate()