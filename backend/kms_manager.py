import os
from google.cloud import kms
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()


class KMSEngine:
    """Envelope encryption with a single DEK per user.

    The DEK (Data Encryption Key) is a Fernet key stored in MongoDB
    (`user_keys` collection), encrypted by Google Cloud KMS (the KEK).

    Flow:
        1. First upload → generate random Fernet key, wrap with KMS, store in Mongo.
        2. Every encrypt/decrypt → fetch wrapped DEK from Mongo, unwrap with KMS,
           use the plaintext Fernet key.

    This means exactly **one KMS call per request** (unwrap), regardless
    of how many files are processed in that request.
    """

    def __init__(self):
        self.key_name = os.getenv("GOOGLE_KMS_KEY_ID")
        if not self.key_name:
            raise ValueError("❌ CRITICAL: GOOGLE_KMS_KEY_ID missing in .env")
        self.client = kms.KeyManagementServiceClient()
        # Cache: owner_id → plaintext DEK bytes  (lives only for this process)
        self._dek_cache = {}
        print("🔐 KMS: Online & Connected")

    @property
    def _kms_key(self):
        """Return the cryptoKey resource name (strip /cryptoKeyVersions/N)."""
        return self.key_name.split("/cryptoKeyVersions")[0]

    # ── DEK lifecycle ─────────────────────────────────────────────────

    def get_or_create_dek(self, owner_id, db):
        """Return the plaintext DEK for a user, creating one if needed.

        Args:
            owner_id: Firebase UID
            db:       PyMongo database object (vaultify_db)

        Returns:
            bytes — the 44-byte Fernet key (plaintext)
        """
        # Fast path — process-local cache
        if owner_id in self._dek_cache:
            return self._dek_cache[owner_id]

        # Try MongoDB
        record = db.user_keys.find_one({"owner_id": owner_id})

        if record and record.get("encrypted_dek"):
            plaintext_dek = self._unwrap(record["encrypted_dek"])
        else:
            # First time for this user — generate + wrap + store
            plaintext_dek = Fernet.generate_key()           # 44 bytes, url-safe base64
            encrypted_dek = self._wrap(plaintext_dek)
            db.user_keys.update_one(
                {"owner_id": owner_id},
                {"$set": {
                    "owner_id":      owner_id,
                    "encrypted_dek": encrypted_dek,          # bytes
                }},
                upsert=True,
            )
            print(f"    🔑 Created new DEK for user {owner_id[:8]}…")

        self._dek_cache[owner_id] = plaintext_dek
        return plaintext_dek

    # ── Envelope operations ───────────────────────────────────────────

    def _wrap(self, plaintext_dek: bytes) -> bytes:
        """Encrypt the DEK with Google KMS (KEK)."""
        response = self.client.encrypt(
            request={"name": self._kms_key, "plaintext": plaintext_dek}
        )
        return response.ciphertext

    def _unwrap(self, encrypted_dek: bytes) -> bytes:
        """Decrypt the DEK with Google KMS (KEK)."""
        response = self.client.decrypt(
            request={"name": self._kms_key, "ciphertext": encrypted_dek}
        )
        return response.plaintext

    # ── File-level encrypt / decrypt ──────────────────────────────────

    @staticmethod
    def encrypt_bytes(dek: bytes, plaintext: bytes) -> bytes:
        """Encrypt file bytes with the user's plaintext DEK."""
        return Fernet(dek).encrypt(plaintext)

    @staticmethod
    def decrypt_bytes(dek: bytes, ciphertext: bytes) -> bytes:
        """Decrypt file bytes with the user's plaintext DEK."""
        return Fernet(dek).decrypt(ciphertext)


kms_engine = KMSEngine()