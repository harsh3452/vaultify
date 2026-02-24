# import os
# from dotenv import load_dotenv
# from google.cloud import kms
# import crcmod  # Google sometimes needs this for verification

# # 1. Load Environment Variables
# load_dotenv()

# # 2. Setup Client
# client = kms.KeyManagementServiceClient()
# key_name = os.getenv("GOOGLE_KMS_KEY_ID")

# print(f"🔑 Testing Key: {key_name}")

# def test_encryption():
#     try:
#         # 3. Prepare Data
#         plaintext = b"This is a secret resume-level project message!"
        
#         # 4. Call Google KMS to Encrypt
#         print("⏳ Sending data to Google KMS...")
#         response = client.encrypt(request={
#             "name": key_name,
#             "plaintext": plaintext
#         })
        
#         ciphertext = response.ciphertext
#         print(f"✅ SUCCESS! Encrypted blob size: {len(ciphertext)} bytes")
#         print("🛡️  Your Service Account has correct permissions!")
#         return True

#     except Exception as e:
#         print("\n❌ FAILED to connect.")
#         print(f"Error: {e}")
#         return False

# if __name__ == "__main__":
#     test_encryption()