# import os
# import io
# import firebase_admin
# from firebase_admin import credentials, storage
# from dotenv import load_dotenv
# from PIL import Image

# load_dotenv()

# class StorageManager:
#     def __init__(self):
#         cred_path   = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "./firebase-admin-sdk.json")
#         bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")

#         if not firebase_admin._apps:
#             cred = credentials.Certificate(cred_path)
#             firebase_admin.initialize_app(cred, {'storageBucket': bucket_name})

#         self.bucket = storage.bucket()
#         print(f"✅ STORAGE: Connected to Firebase bucket '{bucket_name}'")

#     # ------------------------------------------------------------------ #
#     #  COMPRESSION                                                         #
#     # ------------------------------------------------------------------ #
#     def compress_to_webp_bytes(self, raw_bytes, filename=""):
#         """
#         Raw file bytes → compressed WebP bytes (fully in RAM).
#         Falls back to original bytes if compression fails.
#         """
#         try:
#             size_kb = len(raw_bytes) / 1024

#             if   size_kb < 100:  target_kb = size_kb
#             elif size_kb < 200:  target_kb = 45
#             elif size_kb < 500:  target_kb = 95
#             elif size_kb < 1000: target_kb = 275
#             elif size_kb < 1500: target_kb = 325
#             elif size_kb < 2500: target_kb = 625
#             elif size_kb < 3500: target_kb = 825
#             else:                target_kb = size_kb / 2

#             print(f"📉 Compressing: {int(size_kb)}KB → Target {int(target_kb)}KB")

#             # PDF — extract first page
#             if filename.lower().endswith('.pdf'):
#                 from pdf2image import convert_from_bytes
#                 poppler = os.getenv("POPPLER_PATH", None)
#                 images  = convert_from_bytes(raw_bytes, poppler_path=poppler)
#                 img     = images[0].convert("RGB")
#             else:
#                 img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")

#             # Resize huge images first
#             if size_kb > 2000:
#                 img.thumbnail((1920, 1920), Image.Resampling.LANCZOS)

#             quality       = 90
#             resize_factor = 1.0
#             buffer        = io.BytesIO()

#             for _ in range(3):
#                 buffer = io.BytesIO()
#                 img.save(buffer, 'WEBP', quality=quality)
#                 current_kb = buffer.tell() / 1024

#                 if current_kb <= target_kb * 1.1:
#                     break

#                 quality = max(quality - 10, 30)
#                 resize_factor *= 0.8
#                 w, h = img.size
#                 img  = img.resize(
#                     (int(w * resize_factor), int(h * resize_factor)),
#                     Image.Resampling.LANCZOS
#                 )

#             compressed = buffer.getvalue()
#             print(f"✅ Compressed to {int(len(compressed) / 1024)}KB")
#             return compressed

#         except Exception as e:
#             print(f"⚠️ Compression failed: {e} — using original bytes")
#             return raw_bytes

#     # ------------------------------------------------------------------ #
#     #  UPLOAD                                                              #
#     # ------------------------------------------------------------------ #
#     def upload_encrypted(self, encrypted_bytes, user_id, client_name, doc_type, original_filename):
#         """
#         Uploads encrypted bytes to Firebase.
#         Structure: user_id/Client_Name/DocType_filename.webp.enc
#         Returns blob_path — store this in MongoDB.
#         """
#         safe_client = client_name.replace(" ", "_")
#         base        = f"{doc_type}_{os.path.splitext(original_filename)[0]}"
#         enc_name    = f"{base}.webp.enc"
#         blob_path   = f"{user_id}/{safe_client}/{enc_name}"

#         # Auto increment if file already exists
#         counter = 2
#         while self.bucket.blob(blob_path).exists():
#             enc_name  = f"{base}_{counter}.webp.enc"
#             blob_path = f"{user_id}/{safe_client}/{enc_name}"
#             counter  += 1

#         blob = self.bucket.blob(blob_path)
#         blob.upload_from_string(encrypted_bytes, content_type="application/octet-stream")

#         print(f"🔒 Uploaded encrypted: {blob_path}")
#         return blob_path

#     # ------------------------------------------------------------------ #
#     #  DOWNLOAD                                                            #
#     # ------------------------------------------------------------------ #
#     def download_as_bytes(self, blob_path):
#         """Fetches encrypted blob from Firebase into RAM."""
#         return self.bucket.blob(blob_path).download_as_bytes()

#     # ------------------------------------------------------------------ #
#     #  DELETE                                                              #
#     # ------------------------------------------------------------------ #
#     def delete_file(self, blob_path):
#         """Deletes a file from Firebase Storage."""
#         self.bucket.blob(blob_path).delete()
#         return True


# storage_engine = StorageManager()