# Aadhaar Card Sorter

This is a desktop application built with Electron.js that automates the process of sorting Aadhaar card image files. It uses offline Optical Character Recognition (OCR) to read the card's details, intelligently extracts the cardholder's name and Aadhaar number, and then moves the file into a clearly named folder.

## Features

- **Desktop Application:** A simple, clean, and easy-to-use cross-platform desktop app.
- **Offline OCR:** Uses Tesseract.js to perform OCR locally, so no internet connection is required.
- **Aadhaar Validation:** Automatically checks if the provided document appears to be a valid Aadhaar card.
- **Intelligent Extraction:** Extracts both the cardholder's name and the 12-digit Aadhaar number from the document.
- **Automatic Sorting:** Creates a folder named `[Cardholder Name] - [Aadhaar Number]` and moves the processed image into it.
- **Robust File Handling:** Safely handles moving files, even from different drives or partitions.

## Project Structure

```
/sorteer
|-- node_modules/         # Project dependencies
|-- Sorted Documents/     # Default output directory for sorted files
|-- index.html            # The application's user interface
|-- main.js               # The main Electron process (backend logic, OCR, file system)
|-- preload.js            # Secure bridge between main and renderer processes
|-- renderer.js           # Frontend logic for the user interface
|-- package.json          # Project configuration and dependencies
|-- README.md             # This file
```

## Setup and Usage

### 1. Install Dependencies

If you have just cloned the project or the `node_modules` folder is missing, run this command to install all necessary dependencies:

```bash
npm install
```

### 2. Run the Application

To start the application, run the following command in the project's root directory:

```bash
npm start
```

### 3. How to Use

1.  Click the **Import and Sort Document** button.
2.  Select an Aadhaar card image file (`.png`, `.jpg`, etc.) from your computer.
3.  The application will process the file and display the status.
4.  Once finished, the original file will be moved to its new, sorted folder.

## Output

All sorted documents will be placed in the `Sorted Documents` folder, which is created automatically inside the project directory.
