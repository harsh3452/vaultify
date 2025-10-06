Aadhaar & ID Document Sorter (Vaultify)

This is a desktop application built with Electron.js that automates the process of sorting Aadhaar cards and other Indian ID documents. It intelligently extracts the cardholder’s name, document type, number, and other metadata using the Gemini AI API and organizes them into a structured folder system.

Features

Desktop Application: Cross-platform and easy to use.

Offline/Online OCR & Extraction: Combines Tesseract.js offline processing with Gemini API for accurate document extraction.

Supports Multiple ID Types: Aadhaar, PAN, Driving License, Passport, Voter ID.

Automatic Sorting: Documents are moved into [Person Name]_[Last 4 of DocNumber or Year of DOB] folders.

Indexing: Maintains a JSON index of all processed documents.

Duplicate Detection: Automatically detects duplicates to prevent repeated processing.

Multi-file & Folder Processing: Import single files, multiple files, or entire folders at once.

Drag & Drop: Drop image files directly onto the app for processing.

Manual Review Handling: Files that fail extraction are stored in _Manual_Review.

Open Folders/Files: Directly open processed documents or person folders from the app.

Project Structure
/vaultify
|-- node_modules/           # Project dependencies
|-- Processed Documents/    # Sorted documents and index
|   |-- _Manual_Review/     # Files failed to process
|   |-- index.json          # JSON index of all processed documents
|-- index.html              # Application UI
|-- main.js                 # Main Electron process and backend logic
|-- preload.js              # Secure bridge between main and renderer
|-- renderer.js             # Frontend UI logic
|-- package.json            # Project configuration and dependencies
|-- README.md               # This file

Setup and Usage
1. Install Dependencies

If you cloned the project or node_modules is missing:

npm install

2. Run the Application
npm start

3. How to Use

Single File: Click Import and Sort Document and select a single image (.png, .jpg, .jpeg).

Multiple Files: Click Import Multiple and select multiple images.

Folder: Click Import Folder to process all images in a directory.

Drag & Drop: Drag image files directly onto the app window.

The application will process files, detect duplicates, extract metadata, and move the documents into the appropriate folder inside Processed Documents.

Processing Output

All processed documents are stored in Processed Documents.

Each person gets a folder named:

[Full Name in CAPS]_[Last 4 digits of docNumber or Year of DOB]


Metadata for each file is stored as a .json file alongside the document.

Index of all processed documents is maintained in index.json.

Files that fail extraction are moved to _Manual_Review.

Gemini AI Extraction

Vaultify uses the Gemini API for high-quality extraction. The response is stored in JSON format:

{
  "docType": "AADHAAR|PAN|DRIVING_LICENSE|PASSPORT|VOTER_ID",
  "name": "FULL NAME IN CAPITAL LETTERS",
  "docNumber": "DOCUMENT NUMBER",
  "dob": "DD/MM/YYYY",
  "gender": "Male|Female"
}

Notes

Make sure your Gemini API key is set in main.js.

The app automatically normalizes names and prevents duplicate processing.

Supports both offline OCR (for fallback) and Gemini AI for high accuracy extraction.

The system is designed for Indian ID documents but can be extended.

This README now matches your provided enhanced code, including:

Gemini API extraction

Processed folder structure with _Manual_Review

Indexing & duplicate handling

Single, multi-file, folder, and drag-and-drop processing

Metadata JSON per document