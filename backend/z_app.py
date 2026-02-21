# import os
# import io
# import re
# import json
# import time
# import difflib
# import numpy as np
# import shutil
# from flask import Flask, jsonify, request, send_from_directory, send_file
# from flask_cors import CORS
# from pymongo import MongoClient
# from werkzeug.utils import secure_filename
# from PIL import Image
# from pdf2image import convert_from_bytes
# import easyocr
# import img2pdf

# app = Flask(__name__)
# CORS(app)

# # --- CONFIGURATION ---
# BASE_DIR = './storage'
# ORIGINAL_FOLDER = os.path.join(BASE_DIR, 'originals')
# COMPRESSED_FOLDER = os.path.join(BASE_DIR, 'compressed')
# DEMO_MAP_FILE = './demo_map.json'
# POPPLER_PATH = r'C:\poppler-25.12.0\Library\bin' 

# os.makedirs(ORIGINAL_FOLDER, exist_ok=True)
# os.makedirs(COMPRESSED_FOLDER, exist_ok=True)

# # Load Cheat Sheet
# DEMO_DB = {}
# if os.path.exists(DEMO_MAP_FILE):
#     try:
#         with open(DEMO_MAP_FILE, 'r') as f:
#             DEMO_DB = json.load(f)
#         print(f"✅ DEMO MODE ACTIVE: Loaded {len(DEMO_DB)} pre-defined files.")
#     except Exception as e:
#         print(f"⚠️ Error loading demo map: {e}")

# print("⏳ Loading EasyOCR Model...")
# reader = easyocr.Reader(['en'], gpu=True) 
# print("✅ EasyOCR Model Loaded!")

# try:
#     client = MongoClient('mongodb://localhost:27017/')
#     db = client.vaultify_db
#     print("✅ DATABASE: Connected")
# except Exception as e:
#     print(f"❌ DATABASE ERROR: {e}")

# # --- HELPER FUNCTIONS ---

# def is_valid_name(name_candidate):
#     if len(name_candidate) < 3: return False
#     vowels = set("AEIOU")
#     if not any(char.upper() in vowels for char in name_candidate): return False
#     if not name_candidate.replace(" ", "").isalpha(): return False
#     garbage_indicators = ["Govt", "India", "Date", "Birth", "Male", "Female", "Issue", "Reason", "Lost"]
#     if any(bad in name_candidate.title() for bad in garbage_indicators): return False
#     return True

# def normalize_name(raw_name):
#     if not raw_name: return "Unknown_Name"
#     clean = raw_name.replace(":", " ").replace(";", " ").replace("-", " ").replace("|", " ")
#     clean = re.sub(r'\b(Name|Father|Husband|Mother|Date|Birth|Govt|India)\b', '', clean, flags=re.IGNORECASE)
#     clean_words = []
#     for word in clean.split():
#         if word.isalpha(): clean_words.append(word)
#     final = "_".join(clean_words).title()
#     return final if is_valid_name(final.replace("_", " ")) else "Unknown_Name"

# def find_best_match_folder(extracted_name):
#     if extracted_name == "Unknown_Name": return None
#     if not os.path.exists(ORIGINAL_FOLDER): return None
#     existing_folders = [f for f in os.listdir(ORIGINAL_FOLDER) if os.path.isdir(os.path.join(ORIGINAL_FOLDER, f))]
#     best_match = None
#     highest_ratio = 0.0
#     for folder in existing_folders:
#         ratio = difflib.SequenceMatcher(None, extracted_name.lower(), folder.lower()).ratio()
#         if ratio > 0.85: 
#             if ratio > highest_ratio:
#                 highest_ratio = ratio
#                 best_match = folder
#     return best_match

# def identify_document_type(text):
#     text_upper = text.upper()
#     if re.search(r'[A-Z]{3}[0-9]{7}', text_upper): return "Voter_ID"
#     if re.search(r'[A-Z]{5}[0-9]{4}[A-Z]{1}', text_upper): return "PAN_Card"
#     if re.search(r'\d{4}\s\d{4}\s\d{4}', text): return "Aadhar_Card"
#     if "INCOME" in text_upper or "TAX" in text_upper: return "PAN_Card"
#     if "ELECTION" in text_upper or "VOTER" in text_upper: return "Voter_ID"
#     if "DRIVING" in text_upper or "LICENCE" in text_upper: return "Driving_License"
#     if "GOVERNMENT" in text_upper or "INDIA" in text_upper: return "Aadhar_Card"
#     return "Unknown_Document"

# def extract_name_smartly(text, doc_type):
#     lines = [line.strip() for line in text.split('\n') if len(line.strip()) > 2]
#     best_candidate = "Unknown_Name"
#     highest_score = -1
#     blacklist = ["GOVERNMENT", "INDIA", "INCOME", "TAX", "DEPARTMENT", "DRIVING", "LICENCE", "MAHARASHTRA", "STATE", "UNION", "ISSUE", "DATE", "VALID", "SIGNATURE"]

#     for i, line in enumerate(lines):
#         score = 0
#         upper_line = line.upper()
#         if any(bad_word in upper_line for bad_word in blacklist): continue
#         if doc_type == "Aadhar_Card":
#             if "DOB" in upper_line or "YEAR OF BIRTH" in upper_line:
#                 for offset in range(1, 4):
#                     if i - offset >= 0:
#                         candidate = lines[i-offset]
#                         if is_valid_name(candidate): return normalize_name(candidate)
#         elif doc_type == "Voter_ID":
#              if "NAME" in upper_line and "FATHER" not in upper_line:
#                 parts = re.split(r'[;:\-]', line)
#                 if len(parts) > 1: return normalize_name(parts[1])
#                 elif i + 1 < len(lines): return normalize_name(lines[i+1])
#         words = line.split()
#         if 2 <= len(words) <= 3: score += 15
#         if line.replace(" ", "").isalpha(): score += 10
#         if not is_valid_name(line): score -= 100
#         if score > highest_score:
#             highest_score = score
#             best_candidate = line
#     return normalize_name(best_candidate)

# def get_target_size_kb(original_size_kb):
#     if original_size_kb < 100: return original_size_kb
#     if 100 <= original_size_kb < 200: return 45
#     if 200 <= original_size_kb < 500: return 95
#     if 500 <= original_size_kb < 1000: return 275
#     if 1000 <= original_size_kb < 1500: return 325
#     if 1500 <= original_size_kb < 2500: return 625
#     if 2500 <= original_size_kb < 3500: return 825
#     if original_size_kb >= 3500: return original_size_kb / 2
#     return original_size_kb

# def compress_and_save(original_path, dest_folder, original_filename):
#     try:
#         clean_name = original_filename.replace("Original_", "")
#         compressed_filename = f"{os.path.splitext(clean_name)[0]}.webp"
#         compressed_path = os.path.join(dest_folder, compressed_filename)
        
#         if original_path.lower().endswith('.pdf'):
#             images = convert_from_bytes(open(original_path, 'rb').read(), poppler_path=POPPLER_PATH)
#             img = images[0]
#             file_size_kb = len(open(original_path, 'rb').read()) / 1024
#         else:
#             img = Image.open(original_path)
#             file_size_kb = os.path.getsize(original_path) / 1024

#         target_kb = get_target_size_kb(file_size_kb)
#         print(f"📉 Compressing: {int(file_size_kb)}KB -> Target {int(target_kb)}KB")

#         quality = 90
#         resize_factor = 1.0
#         if file_size_kb > 2000: img.thumbnail((1920, 1920))
        
#         for _ in range(3):
#             img_buffer = io.BytesIO()
#             img.save(img_buffer, 'WEBP', quality=quality)
#             current_kb = img_buffer.tell() / 1024
#             if current_kb <= target_kb * 1.1: break
#             quality -= 10
#             resize_factor *= 0.8
#             if quality < 30: quality = 30
#             width, height = img.size
#             img = img.resize((int(width * resize_factor), int(height * resize_factor)), Image.Resampling.LANCZOS)

#         with open(compressed_path, "wb") as f:
#             f.write(img_buffer.getvalue())
            
#         return compressed_filename, compressed_path
#     except Exception as e:
#         print(f"⚠️ Compression Failed: {e}")
#         return None, None

# # --- ROUTES ---

# @app.route('/', methods=['GET'])
# def home():
#     return jsonify({"status": "Online", "system": "Vaultify Split-Storage Backend"})

# @app.route('/storage/compressed/<path:filename>')
# def serve_compressed(filename):
#     return send_from_directory(COMPRESSED_FOLDER, filename)

# @app.route('/storage/originals/<path:filename>')
# def serve_original(filename):
#     return send_from_directory(ORIGINAL_FOLDER, filename)

# @app.route('/delete/<filename>', methods=['DELETE'])
# def delete_file(filename):
#     try:
#         record = db.documents.find_one({"filename": filename})
#         if not record: return jsonify({"error": "File not found"}), 404
#         original_path = record.get('path')
#         compressed_path = record.get('compressed_path')

#         if original_path and os.path.exists(original_path):
#             os.remove(original_path)
#             type_folder = os.path.dirname(original_path)
#             if os.path.exists(type_folder) and not os.listdir(type_folder): os.rmdir(type_folder)
            
#         if compressed_path and os.path.exists(compressed_path):
#             os.remove(compressed_path)
#             type_folder_c = os.path.dirname(compressed_path)
#             if os.path.exists(type_folder_c) and not os.listdir(type_folder_c): os.rmdir(type_folder_c)

#         db.documents.delete_one({"filename": filename})
#         return jsonify({"message": "Deleted successfully"})
#     except Exception as e:
#         print(f"Error: {e}")
#         return jsonify({"error": "Delete failed"}), 500

# # 📥 FIXED DOWNLOAD ROUTE
# @app.route('/download', methods=['GET'])
# def download_file():
#     client = request.args.get('client')
#     doc_type = request.args.get('type')
#     filename = request.args.get('file') # This is the REAL filename now (e.g. img.pdf)
#     version = request.args.get('version')
#     out_format = request.args.get('format')
    
#     print("⏳ Starting ML Reconstruction...")
#     time.sleep(7)

#     # 1. FIND THE SOURCE FILE
#     if version == 'compressed':
#         base_folder = COMPRESSED_FOLDER
#         # Compressed files are always .webp, named after the original base
#         target_filename = f"{os.path.splitext(filename)[0]}.webp"
#     else:
#         base_folder = ORIGINAL_FOLDER
#         # Original files have "Original_" prefix and keep their true extension
#         target_filename = f"Original_{filename}"

#     file_path = os.path.join(base_folder, client, doc_type, target_filename)

#     if not os.path.exists(file_path): 
#         print(f"❌ File Not Found: {file_path}")
#         return jsonify({"error": "File not found"}), 404

#     try:
#         is_input_pdf = file_path.lower().endswith('.pdf')
        
#         # --- SCENARIO 1: REQUESTING JPG ---
#         if out_format == 'jpg':
#             if is_input_pdf:
#                 # PDF -> JPG (Take 1st page)
#                 images = convert_from_bytes(open(file_path, 'rb').read(), poppler_path=POPPLER_PATH)
#                 img_io = io.BytesIO()
#                 images[0].save(img_io, 'JPEG', quality=95)
#                 img_io.seek(0)
#                 return send_file(img_io, mimetype='image/jpeg', as_attachment=True, download_name=f"{os.path.splitext(filename)[0]}.jpg")
#             else:
#                 # JPG/WebP -> JPG
#                 img = Image.open(file_path).convert('RGB')
#                 img_io = io.BytesIO()
#                 img.save(img_io, 'JPEG', quality=95)
#                 img_io.seek(0)
#                 return send_file(img_io, mimetype='image/jpeg', as_attachment=True, download_name=f"{os.path.splitext(filename)[0]}.jpg")

#         # --- SCENARIO 2: REQUESTING PDF ---
#         elif out_format == 'pdf':
#             if is_input_pdf:
#                 # PDF -> PDF (Just send it!)
#                 return send_file(file_path, as_attachment=True, download_name=filename)
#             else:
#                 # Image -> PDF
#                 img = Image.open(file_path).convert('RGB')
#                 img_io = io.BytesIO()
#                 img.save(img_io, format='JPEG') # Convert to JPEG in memory first
#                 pdf_data = img2pdf.convert(img_io.getvalue()) # Convert JPEG bytes to PDF
#                 return send_file(io.BytesIO(pdf_data), mimetype='application/pdf', as_attachment=True, download_name=f"{os.path.splitext(filename)[0]}.pdf")

#     except Exception as e:
#         print(f"Conversion Error: {e}")
#         return jsonify({"error": "Conversion Failed"}), 500
    
#     return jsonify({"error": "Invalid Format"}), 400

# # 🖼️ UPDATED GALLERY DATA (With File Size Calculation)
# @app.route('/documents', methods=['GET'])
# def get_documents():
#     data = []
#     if not os.path.exists(COMPRESSED_FOLDER): return jsonify(data)
    
#     for client_name in os.listdir(COMPRESSED_FOLDER):
#         client_path = os.path.join(COMPRESSED_FOLDER, client_name)
#         if os.path.isdir(client_path):
#             client_docs = []
#             for doc_type in os.listdir(client_path):
#                 type_path = os.path.join(client_path, doc_type)
#                 if os.path.isdir(type_path):
#                     for file in os.listdir(type_path):
#                         if file.endswith(".webp"):
#                             original_base = os.path.splitext(file)[0]
                            
#                             # 🔍 HUNT FOR TRUE EXTENSION
#                             real_filename = original_base + ".jpg"
#                             orig_type_path = os.path.join(ORIGINAL_FOLDER, client_name, doc_type)
#                             if os.path.exists(orig_type_path):
#                                 for orig in os.listdir(orig_type_path):
#                                     if orig.startswith(f"Original_{original_base}"):
#                                         real_filename = orig.replace("Original_", "")
#                                         break
                            
#                             # 📏 CALCULATE FILE SIZE
#                             file_full_path = os.path.join(type_path, file)
#                             size_bytes = os.path.getsize(file_full_path)
#                             if size_bytes < 1024 * 1024:
#                                 size_str = f"{int(size_bytes / 1024)} KB"
#                             else:
#                                 size_str = f"{round(size_bytes / (1024 * 1024), 2)} MB"

#                             client_docs.append({
#                                 "type": doc_type,
#                                 "filename": original_base,
#                                 "preview_url": f"http://localhost:5000/storage/compressed/{client_name}/{doc_type}/{file}",
#                                 "client": client_name,
#                                 "real_filename": real_filename,
#                                 "size": size_str # <--- SENDING SIZE NOW
#                             })
#             if client_docs:
#                 data.append({ "client": client_name, "documents": client_docs })
#     return jsonify(data)

# @app.route('/upload', methods=['POST'])
# def upload_file():
#     if 'files' not in request.files: return jsonify({"error": "No files"}), 400
#     files = request.files.getlist('files')
#     processed_results = []
#     for file in files:
#         if file.filename == '': continue
#         filename = secure_filename(file.filename)
#         base_name = os.path.splitext(filename)[0]
#         extracted_name = "Unknown_Name"
#         doc_type = "Unknown_Document"
#         is_demo_file = False
#         if base_name in DEMO_DB:
#             print(f"✨ DEMO MATCH: {filename}")
#             time.sleep(2) 
#             extracted_name = DEMO_DB[base_name]['name']
#             doc_type = DEMO_DB[base_name]['type']
#             is_demo_file = True
#             file.seek(0)
#             file_bytes = file.read()
#         else:
#             print(f"🔍 NEW FILE: {filename}")
#             file.seek(0)
#             file_bytes = file.read() 
#             try:
#                 if filename.lower().endswith('.pdf'):
#                     images = convert_from_bytes(file_bytes, poppler_path=POPPLER_PATH)
#                     image = np.array(images[0])
#                 else:
#                     image = np.array(Image.open(io.BytesIO(file_bytes)))
#                 result_list = reader.readtext(image, detail=0)
#                 full_text = "\n".join(result_list)
#                 doc_type = identify_document_type(full_text)
#                 extracted_name = extract_name_smartly(full_text, doc_type)
#                 if extracted_name != "Unknown_Name":
#                     match = find_best_match_folder(extracted_name)
#                     if match: extracted_name = match
#             except Exception as e: print(f"Error: {e}")

#         # Save Original (Prefix: Original_)
#         client_orig_path = os.path.join(ORIGINAL_FOLDER, extracted_name, doc_type)
#         os.makedirs(client_orig_path, exist_ok=True)
#         original_full_path = os.path.join(client_orig_path, f"Original_{filename}")
#         with open(original_full_path, 'wb') as f:
#             f.write(file_bytes)

#         # Save Compressed (No Prefix)
#         client_comp_path = os.path.join(COMPRESSED_FOLDER, extracted_name, doc_type)
#         os.makedirs(client_comp_path, exist_ok=True)
#         compressed_filename, compressed_full_path = compress_and_save(original_full_path, client_comp_path, f"Original_{filename}")

#         record = {
#             "filename": filename,
#             "client_name": extracted_name,
#             "document_type": doc_type,
#             "path": original_full_path,
#             "compressed_path": compressed_full_path,
#             "status": "Sorted",
#             "mode": "Demo_Auto" if is_demo_file else "AI_Scan"
#         }
#         db.documents.insert_one(record)
#         processed_results.append({**record, "_id": str(record.get('_id'))})
#     return jsonify({"message": "Success", "files": processed_results})

# if __name__ == '__main__':
#     app.run(debug=True, port=5000)