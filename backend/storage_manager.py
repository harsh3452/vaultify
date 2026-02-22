import os
import io
import firebase_admin
from firebase_admin import credentials, storage
from dotenv import load_dotenv
from PIL import Image

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

    def upload_file(self, file_bytes, user_id, client_name, doc_type, original_filename):
        """Upload raw (unencrypted) webp to Firebase."""
        safe_client = client_name.replace(" ", "_")
        base = f"{client_name}_{doc_type}"
        filename    = f"{base}.webp"
        blob_path   = f"{user_id}/{safe_client}/{filename}"

        counter = 2
        while self.bucket.blob(blob_path).exists():
            filename  = f"{base}_{counter}.webp"
            blob_path = f"{user_id}/{safe_client}/{filename}"
            counter  += 1

        blob = self.bucket.blob(blob_path)
        blob.upload_from_string(file_bytes, content_type="image/webp")
        print(f"📁 Uploaded: {blob_path}")
        return blob_path

    # Keep for when encryption is re-enabled
    def upload_encrypted(self, file_bytes, user_id, client_name, doc_type, original_filename):
        return self.upload_file(file_bytes, user_id, client_name, doc_type, original_filename)

    def download_as_bytes(self, blob_path):
        return self.bucket.blob(blob_path).download_as_bytes()

    def delete_file(self, blob_path):
        self.bucket.blob(blob_path).delete()
        return True

storage_engine = StorageManager()