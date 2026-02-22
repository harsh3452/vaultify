"""
firebase_init.py
────────────────
Single source of truth for Firebase Admin SDK initialization.
Import this module first in any file that needs firebase_admin.

Both storage_manager.py and auth.py import from here so the app
is guaranteed to be initialized exactly once before any service
(Firestore, Storage, Auth) is accessed.
"""
import os
import firebase_admin
from firebase_admin import credentials
from dotenv import load_dotenv

load_dotenv()

def _init():
    if firebase_admin._apps:
        return  # Already initialized — skip

    cred_path   = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "./firebase-admin-sdk.json")
    bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET", "")

    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {
        "storageBucket": bucket_name,
    })
    print(f"🔥 Firebase Admin initialized | bucket: {bucket_name}")

_init()
