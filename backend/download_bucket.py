import os
import firebase_admin
from firebase_admin import credentials, storage
from dotenv import load_dotenv

load_dotenv()

# Initialize Firebase
cred = credentials.Certificate(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "./firebase-admin-key.json"))
firebase_admin.initialize_app(cred, {
    # Your exact bucket name from the URL
    'storageBucket': 'vaultify-54eb7.firebasestorage.app' 
})

def download_entire_bucket(local_destination_folder="vaultify_backup"):
    bucket = storage.bucket()
    blobs = bucket.list_blobs()
    
    downloaded_count = 0
    
    for blob in blobs:
        local_file_path = os.path.join(local_destination_folder, blob.name)
        
        # Create the local directories if they don't exist
        os.makedirs(os.path.dirname(local_file_path), exist_ok=True)
        
        # Download the file
        print(f"Downloading: {blob.name} ...")
        blob.download_to_filename(local_file_path)
        downloaded_count += 1
        
    print(f"\n✅ Done! Downloaded {downloaded_count} files to '{local_destination_folder}'")

if __name__ == "__main__":
    download_entire_bucket()