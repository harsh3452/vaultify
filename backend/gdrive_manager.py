"""
Google Drive Manager for Vaultify
Handles authentication, folder management, and file uploads to Google Drive
"""

import os
import io
import datetime
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.api_core.exceptions import GoogleAPIError
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/drive.file"]


class GDriveManager:
    """Manages Google Drive interactions for document storage."""
    
    def __init__(self):
        self.service = None
        self.current_user_creds = None
        self.vaultify_folder_id = None
        self.token_error_uid = None  # track last token error for cache-busting
    
    def get_auth_service(self, refresh_token=None, access_token=None):
        """
        Create an authenticated Google Drive service using a refresh token or access token.
        
        Uses refresh_token for long-lived access (valid ~7 days with no expiry if unused).
        Falls back to access_token for short-lived access (~1 hour).
        
        Args:
            refresh_token (str): Google OAuth refresh token for long-term offline access
            access_token (str): Google OAuth access token for immediate use
            
        Returns:
            google.googleapiclient.discovery.Resource: Authorized Drive API service
        """
        try:
            creds = None
            
            if refresh_token:
                # Create credentials from refresh_token (preferred — long-lived)
                creds_dict = {
                    'type': 'authorized_user',
                    'client_id': os.getenv('GOOGLE_CLIENT_ID'),
                    'client_secret': os.getenv('GOOGLE_CLIENT_SECRET'),
                    'refresh_token': refresh_token,
                }
                creds = Credentials.from_authorized_user_info(creds_dict, scopes=SCOPES)
                # Refresh to get a fresh access_token
                creds.refresh(Request())
                print(f"✅ GDRIVE: Authenticated with refresh token")
                
            elif access_token:
                # Create credentials from access_token (short-lived ~1hr)
                creds = Credentials(token=access_token, scopes=SCOPES)
                print(f"✅ GDRIVE: Authenticated with access token (will expire in ~1hr)")
            else:
                raise ValueError("Either refresh_token or access_token must be provided")
            
            # Build the Drive API service
            service = build('drive', 'v3', credentials=creds, cache_discovery=False)
            return service
            
        except Exception as e:
            err_str = str(e)
            print(f"❌ GDRIVE: Auth failed - {err_str}")
            
            # Detect expired/revoked refresh token — this needs user re-auth
            if "invalid_grant" in err_str or "Token has been expired or revoked" in err_str:
                raise TokenExpiredError(
                    "Google Drive token expired or revoked. Please reconnect via Settings."
                )
            raise

    def _ensure_valid_token(self, service, owner_id, db):
        """Check if the token is about to expire and refresh if possible.
        
        Returns the service (same or refreshed). Raises TokenExpiredError if
        the refresh token itself is dead.
        """
        try:
            # The Google client library auto-refreshes, so this test call should work
            # if the credential is valid. We do a lightweight API call.
            service.files().list(pageSize=1, fields='files(id)').execute()
            return service
        except GoogleAPIError as e:
            if e.resp and e.resp.status in (401, 403):
                # Could be expired — try to clear stored token so frontend shows "not connected"
                if owner_id:
                    db.users.update_one(
                        {"uid": owner_id},
                        {
                            "$unset": {
                                "gdrive_refresh_token_enc": "",
                                "gdrive_access_token_enc": "",
                            }
                        }
                    )
                raise TokenExpiredError(
                    "Google Drive token expired. Please reconnect via Settings."
                )
            raise
    
    @staticmethod
    def _escape_q(value: str) -> str:
        """Escape a string value for use in Google Drive API queries.
        
        Single quotes in values must be escaped as \\' otherwise the query
        will throw a 400 error (e.g. client names like "O'BRIEN").
        """
        return value.replace("'", "\\'")

    def get_or_create_folder(self, service, folder_name, parent_folder_id=None):
        """
        Get an existing folder by name or create it if it doesn't exist.
        
        Args:
            service: Authenticated Drive API service
            folder_name (str): Name of the folder
            parent_folder_id (str, optional): Parent folder ID. If None, uses root.
            
        Returns:
            str: Folder ID
        """
        try:
            # Build query to find folder by name (escape single quotes to prevent injection)
            safe_name = self._escape_q(folder_name)
            query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            
            if parent_folder_id:
                query += f" and '{parent_folder_id}' in parents"
            else:
                query += " and 'root' in parents"
            
            # Search for the folder
            results = service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)',
                pageSize=1
            ).execute()
            
            files = results.get('files', [])
            
            if files:
                folder_id = files[0]['id']
                print(f"✅ GDRIVE: Found existing folder '{folder_name}' (ID: {folder_id})")
                return folder_id
            
            # Folder doesn't exist, create it
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder',
            }
            
            if parent_folder_id:
                file_metadata['parents'] = [parent_folder_id]
            
            folder = service.files().create(
                body=file_metadata,
                fields='id'
            ).execute()
            
            folder_id = folder.get('id')
            print(f"✅ GDRIVE: Created new folder '{folder_name}' (ID: {folder_id})")
            return folder_id
            
        except GoogleAPIError as e:
            print(f"❌ GDRIVE: Folder operation failed - {str(e)}")
            raise
    
    def create_folder_hierarchy(self, service, client_name, doc_type):
        """
        Create or get the folder hierarchy: Vaultify / ClientName / DocumentType
        
        Args:
            service: Authenticated Drive API service
            client_name (str): Client name (e.g., "Aditya_Prabhash_Lal")
            doc_type (str): Document type (e.g., "PAN_Card", "Aadhar_Card")
            
        Returns:
            str: Document type folder ID where files should be uploaded
        """
        try:
            # Step 1: Get or create "Vaultify" folder in root
            vaultify_id = self.get_or_create_folder(service, "Vaultify")
            
            # Step 2: Get or create client folder under Vaultify
            client_id = self.get_or_create_folder(service, client_name, parent_folder_id=vaultify_id)
            
            # Step 3: Get or create document type folder under client
            doc_type_id = self.get_or_create_folder(service, doc_type, parent_folder_id=client_id)
            
            print(f"✅ GDRIVE: Ready to upload to {client_name}/{doc_type}")
            return doc_type_id
            
        except Exception as e:
            print(f"❌ GDRIVE: Folder hierarchy creation failed - {str(e)}")
            raise
    
    def upload_file(self, service, file_bytes, filename, destination_folder_id):
        """
        Upload a file to a specific Google Drive folder.
        
        Args:
            service: Authenticated Drive API service
            file_bytes (bytes): File content as bytes
            filename (str): Name of the file
            destination_folder_id (str): ID of the destination folder
            
        Returns:
            dict: File metadata including 'id' (Google Drive file ID)
        """
        try:
            file_metadata = {
                'name': filename,
                'parents': [destination_folder_id]
            }
            
            # Create MediaIoBaseUpload for streaming upload
            media = MediaIoBaseUpload(
                io.BytesIO(file_bytes),
                mimetype='application/octet-stream',
                resumable=True
            )
            
            file_obj = service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id, name, createdTime, mimeType',
                supportsAllDrives=False
            ).execute()
            
            file_id = file_obj.get('id')
            print(f"✅ GDRIVE: Uploaded '{filename}' → File ID: {file_id}")
            return file_obj
            
        except GoogleAPIError as e:
            print(f"❌ GDRIVE: Upload failed for '{filename}' - {str(e)}")
            raise
    
    def download_file_bytes(self, service, file_id):
        """
        Download a Google Drive file as bytes.

        Args:
            service: Authenticated Drive API service
            file_id (str): Google Drive file ID

        Returns:
            bytes: File contents
        """
        try:
            request = service.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buf.getvalue()
        except GoogleAPIError as e:
            print(f"❌ GDRIVE: Download failed for file ID {file_id} - {str(e)}")
            if e.resp and e.resp.status in (401, 403):
                raise TokenExpiredError("Google Drive token expired while downloading.")
            raise
    
    def delete_file(self, service, file_id):
        """
        Delete a file from Google Drive.
        
        Args:
            service: Authenticated Drive API service
            file_id (str): Google Drive file ID to delete
            
        Returns:
            bool: True if deletion was successful
        """
        try:
            service.files().delete(fileId=file_id).execute()
            print(f"✅ GDRIVE: Deleted file (ID: {file_id})")
            return True
        except GoogleAPIError as e:
            print(f"❌ GDRIVE: Deletion failed - {str(e)}")
            raise

    def find_folder_by_name(self, service, folder_name, parent_folder_id=None):
        """
        Find a folder by name, optionally under a parent.
        
        Args:
            service: Authenticated Drive API service
            folder_name (str): Name of the folder
            parent_folder_id (str, optional): Parent folder ID. If None, searches root.
            
        Returns:
            str: Folder ID or None if not found
        """
        try:
            safe_name = self._escape_q(folder_name)
            query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            if parent_folder_id:
                query += f" and '{parent_folder_id}' in parents"
            else:
                query += " and 'root' in parents"
            results = service.files().list(
                q=query, spaces='drive', fields='files(id, name)', pageSize=1
            ).execute()
            files = results.get('files', [])
            return files[0]['id'] if files else None
        except GoogleAPIError:
            return None

    def delete_folder_hierarchy(self, service, client_name, doc_type):
        """
        Delete the folder hierarchy: Vaultify/ClientName/DocType and clean up empty parents.
        
        Deletes the doc-type folder, then the client folder if empty,
        then the Vaultify folder if empty.
        
        Args:
            service: Authenticated Drive API service
            client_name (str): Client folder name (e.g., "ADITYA_PRABHASH_LAL")
            doc_type (str): Document type folder name (e.g., "PAN_Card")
            
        Returns:
            dict: Summary of deleted folder IDs
        """
        result = {"doc_type": None, "client": None, "vaultify": None}
        try:
            vaultify_id = self.find_folder_by_name(service, "Vaultify")
            if not vaultify_id:
                return result

            client_id = self.find_folder_by_name(service, client_name, parent_folder_id=vaultify_id)
            if not client_id:
                return result

            doc_type_id = self.find_folder_by_name(service, doc_type, parent_folder_id=client_id)
            if doc_type_id:
                try:
                    service.files().delete(fileId=doc_type_id).execute()
                    result["doc_type"] = doc_type_id
                    print(f"🗑️ GDRIVE: Deleted folder '{doc_type}' (ID: {doc_type_id})")
                except GoogleAPIError as e:
                    print(f"⚠️ GDRIVE: Failed to delete doc-type folder '{doc_type}': {e}")

            # Check if client folder is now empty
            remaining = service.files().list(
                q=f"'{client_id}' in parents and trashed=false",
                spaces='drive', fields='files(id)', pageSize=1
            ).execute().get('files', [])
            if not remaining:
                try:
                    service.files().delete(fileId=client_id).execute()
                    result["client"] = client_id
                    print(f"🗑️ GDRIVE: Deleted empty client folder '{client_name}' (ID: {client_id})")
                except GoogleAPIError as e:
                    print(f"⚠️ GDRIVE: Failed to delete client folder '{client_name}': {e}")

                # Check if Vaultify folder is now empty
                remaining = service.files().list(
                    q=f"'{vaultify_id}' in parents and trashed=false",
                    spaces='drive', fields='files(id)', pageSize=1
                ).execute().get('files', [])
                if not remaining:
                    try:
                        service.files().delete(fileId=vaultify_id).execute()
                        result["vaultify"] = vaultify_id
                        print(f"🗑️ GDRIVE: Deleted empty Vaultify root folder")
                    except GoogleAPIError as e:
                        print(f"⚠️ GDRIVE: Failed to delete Vaultify folder: {e}")

        except GoogleAPIError as e:
            print(f"⚠️ GDRIVE: Folder hierarchy deletion failed: {e}")

        return result


class TokenExpiredError(Exception):
    """Raised when the Google Drive refresh token has been revoked or expired."""
    pass


# Singleton instance
gdrive_engine = GDriveManager()