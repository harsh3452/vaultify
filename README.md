# Aadhaar & ID Document Sorter (Vaultify)

Vaultify is a desktop application built with **Electron.js** that automates sorting Aadhaar cards and other Indian ID documents. It intelligently extracts the cardholder’s name, document type, number, and other metadata using the **Gemini AI API** and organizes documents into a structured folder system.

---

## Features

* **Desktop Application:** Cross-platform and easy to use.
* **Offline/Online OCR & Extraction:** Combines Tesseract.js offline processing with Gemini AI for accurate extraction.
* **Supports Multiple ID Types:** Aadhaar, PAN, Driving License, Passport, Voter ID.
* **Automatic Sorting:** Documents are moved into `[Person Name]_[Last 4 of DocNumber or Year of DOB]` folders.
* **Indexing:** Maintains a JSON index of all processed documents (`index.json`).
* **Duplicate Detection:** Automatically detects duplicates to prevent repeated processing.
* **Multi-file & Folder Processing:** Import single files, multiple files, or entire folders at once.
* **Drag & Drop:** Drop image files directly onto the app window.
* **Manual Review Handling:** Files that fail extraction are stored in `_Manual_Review`.
* **Open Folders/Files:** Directly open processed documents or person folders from the app.

---

## Project Structure

```
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
```

---

## Setup and Usage

### 1. Install Dependencies

If you cloned the project or `node_modules` is missing:

```bash
npm install
```

---

### 2. Run the Application

```bash
npm start
```

---

### 3. How to Use

* **Single File:** Click **Import and Sort Document** and select a single image (`.png`, `.jpg`, `.jpeg`).
* **Multiple Files:** Click **Import Multiple** and select multiple images.
* **Folder:** Click **Import Folder** to process all images in a directory.
* **Drag & Drop:** Drag image files directly onto the app window.

The app will process files, detect duplicates, extract metadata, and move the documents into the appropriate folder inside **Processed Documents**.

---

## Processing Output

* All processed documents are stored in **Processed Documents**.
* Each person gets a folder named:

```
[FULL NAME IN CAPS]_[Last 4 digits of docNumber or Year of DOB]
```

* Metadata for each file is stored as a `.json` file alongside the document.
* Index of all processed documents is maintained in `index.json`.
* Files that fail extraction are moved to `_Manual_Review`.

---

## Gemini AI Extraction

Vaultify uses the **Gemini API** for high-quality extraction. The response is stored in JSON format:

```json
{
  "docType": "AADHAAR|PAN|DRIVING_LICENSE|PASSPORT|VOTER_ID",
  "name": "FULL NAME IN CAPITAL LETTERS",
  "docNumber": "DOCUMENT NUMBER",
  "dob": "DD/MM/YYYY",
  "gender": "Male|Female"
}
```

---

## Notes

* Make sure your **Gemini API key** is set in `main.js`.
* The app automatically **normalizes names** and prevents duplicate processing.
* Supports both **offline OCR** (fallback) and **Gemini AI** for high-accuracy extraction.
* The system is designed for **Indian ID documents** but can be extended to other document types.

---

This is now **clean, readable, and professional**, ready to paste into your `README.md`.

I can also create a **short “Quick Start” version** that’s one screen long for GitHub’s front page, so visitors immediately understand the app. Do you want me to do that?
