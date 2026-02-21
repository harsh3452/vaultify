import os
from google.cloud import kms
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

class KMSEngine:
    def __init__(self):
        self.key_name = os.getenv("GOOGLE_KMS_KEY_ID")
        if not self.key_name:
            raise ValueError("❌ CRITICAL: GOOGLE_KMS_KEY_ID missing in .env")
        self.client = kms.KeyManagementServiceClient()
        print(f"🔐 KMS: Online & Connected")

    def _kms_key(self):
        return self.key_name.split("/cryptoKeyVersions")[0]

    def encrypt(self, plaintext_bytes):
        # 1. Generate a random DEK
        dek = Fernet.generate_key()
        
        # 2. Encrypt file with DEK (no size limit)
        encrypted_data = Fernet(dek).encrypt(plaintext_bytes)
        
        # 3. Encrypt DEK with KMS (only 44 bytes — well within 64KB)
        encrypted_dek = self.client.encrypt(
            request={'name': self._kms_key(), 'plaintext': dek}
        ).ciphertext
        
        # 4. Return both together (split later with separator)
        separator = b"||DEK||"
        return encrypted_dek + separator + encrypted_data

    def decrypt(self, combined_bytes):
        # 1. Split DEK and data
        separator = b"||DEK||"
        encrypted_dek, encrypted_data = combined_bytes.split(separator, 1)
        
        # 2. Decrypt DEK with KMS
        dek = self.client.decrypt(
            request={'name': self._kms_key(), 'ciphertext': encrypted_dek}
        ).plaintext
        
        # 3. Decrypt file with DEK
        return Fernet(dek).decrypt(encrypted_data)

kms_engine = KMSEngine()