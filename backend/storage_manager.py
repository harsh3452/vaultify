import os
import io
import firebase_admin
from firebase_admin import credentials, storage
from dotenv import load_dotenv
from PIL import Image
from kms_manager import kms_engine

load_dotenv()

class StorageManager:
    def __init__(self):
        cred_path   = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "./firebase-admin-sdk.json")
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")

        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred, {'storageBucket': bucket_name})

        self.bucket = storage.bucket()
        print(f"✅ STORAGE: Connected to Firebase bucket '{bucket_name}'")

    def compress_to_webp_bytes(self, raw_bytes, filename="", quality_override=None):
        try:
            size_kb = len(raw_bytes) / 1024
            if   size_kb < 100:  target_kb = size_kb
            elif size_kb < 200:  target_kb = 120
            elif size_kb < 500:  target_kb = 200
            elif size_kb < 1000: target_kb = 275
            elif size_kb < 1500: target_kb = 325
            elif size_kb < 2500: target_kb = 625
            elif size_kb < 3500: target_kb = 825
            else:                target_kb = size_kb / 2

            print(f"📉 Compressing: {int(size_kb)}KB → Target {int(target_kb)}KB")

            if filename.lower().endswith('.pdf'):
                from pdf2image import convert_from_bytes
                poppler = os.getenv("POPPLER_PATH", None)
                images  = convert_from_bytes(raw_bytes, poppler_path=poppler)
                img     = images[0].convert("RGB")
            else:
                img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")

            if size_kb > 2000:
                img.thumbnail((1920, 1920), Image.Resampling.LANCZOS)

            quality, resize_factor, buffer = quality_override or 90, 1.0, io.BytesIO()
            for _ in range(3):
                buffer = io.BytesIO()
                img.save(buffer, 'WEBP', quality=quality)
                if buffer.tell() / 1024 <= target_kb * 1.1:
                    break
                if not quality_override:
                    quality = max(quality - 10, 30)
                    resize_factor *= 0.8
                    w, h = img.size
                    img = img.resize((int(w * resize_factor), int(h * resize_factor)), Image.Resampling.LANCZOS)

            print(f"✅ Compressed to {int(buffer.tell() / 1024)}KB")
            return buffer.getvalue()

        except Exception as e:
            print(f"⚠️ Compression failed: {e} — using original bytes")
            return raw_bytes

    # ── Plain upload (unencrypted) ────────────────────────────────────

    def upload_file(self, file_bytes, user_id, doc_id, **_kwargs):
        """Upload webp to Firebase using a flat UUID-based path.

        Path format: {user_id}/docs/{doc_id}.webp
        """
        blob_path = f"{user_id}/docs/{doc_id}.webp"
        blob = self.bucket.blob(blob_path)
        blob.upload_from_string(file_bytes, content_type="image/webp")
        print(f"📁 Uploaded: {blob_path}")
        return blob_path

    # ── Encrypted upload ──────────────────────────────────────────────

    def upload_encrypted(self, plaintext_bytes, user_id, doc_id, dek):
        """Encrypt with the user's DEK then upload to Firebase.

        Stored as application/octet-stream with .enc extension so it
        is never accidentally served as a raw image.
        """
        ciphertext = kms_engine.encrypt_bytes(dek, plaintext_bytes)
        blob_path  = f"{user_id}/docs/{doc_id}.webp.enc"
        blob = self.bucket.blob(blob_path)
        blob.upload_from_string(ciphertext, content_type="application/octet-stream")
        print(f"🔒 Uploaded encrypted: {blob_path} ({len(plaintext_bytes)}→{len(ciphertext)} bytes)")
        return blob_path

    # ── Plain download ────────────────────────────────────────────────

    def download_as_bytes(self, blob_path):
        """Fetch raw blob from Firebase into RAM."""
        return self.bucket.blob(blob_path).download_as_bytes()

    # ── Encrypted download ────────────────────────────────────────────

    def download_decrypted(self, blob_path, dek):
        """Download blob and decrypt with user's DEK."""
        ciphertext = self.bucket.blob(blob_path).download_as_bytes()
        return kms_engine.decrypt_bytes(dek, ciphertext)

    # ── Delete ────────────────────────────────────────────────────────

    def delete_file(self, blob_path):
        self.bucket.blob(blob_path).delete()
        return True

storage_engine = StorageManager()