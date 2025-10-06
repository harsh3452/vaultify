const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;
let isProcessing = false;
let shouldStop = false;

// ============ CONFIG ============
const GEMINI_API_KEY = '';
const PROCESSED_DIR = path.join(__dirname, 'Processed Documents');
const INDEX_FILE = path.join(PROCESSED_DIR, 'index.json');
const FAILED_DIR = path.join(PROCESSED_DIR, '_Manual_Review');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============ INDEX MANAGEMENT ============
async function loadIndex() {
  try {
    const data = await fs.readFile(INDEX_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { documents: [] };
  }
}

async function saveIndex(index) {
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

async function addToIndex(metadata) {
  const index = await loadIndex();
  const exists = index.documents.find(d => d.fileName === metadata.fileName);
  if (exists) {
    Object.assign(exists, metadata);
  } else {
    index.documents.push(metadata);
  }
  await saveIndex(index);
}

// ============ GEMINI EXTRACTION ============
async function extractWithGemini(imagePath) {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const ext = path.extname(imagePath).toLowerCase();
    let mimeType = 'image/jpeg';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64Image } },
              { text: `Extract document information from this Indian ID document. Return ONLY valid JSON with this exact structure: {"docType":"AADHAAR|PAN|DRIVING_LICENSE|PASSPORT|VOTER_ID","name":"FULL NAME IN CAPITAL LETTERS","docNumber":"DOCUMENT NUMBER","dob":"DD/MM/YYYY","gender":"Male|Female"}. If any field is not found, use null.` }
            ]
          }],
          generationConfig: { 
            temperature: 0.1, 
            responseMimeType: "application/json" 
          }
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }
    
    const resultText = data.candidates[0].content.parts[0].text;
    const result = JSON.parse(resultText);
    
    if (!result.name || !result.docType) {
      throw new Error('Incomplete extraction: missing name or docType');
    }
    
    result.name = result.name.toUpperCase().trim();
    
    return result;
  } catch (error) {
    console.error('Gemini extraction error:', error);
    throw error;
  }
}

// ============ FIND OR CREATE PERSON FOLDER ============
async function findOrCreatePersonFolder(normalizedName, docNumber, dob) {
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  const items = await fs.readdir(PROCESSED_DIR, { withFileTypes: true });
  const folders = items.filter(i => i.isDirectory() && !i.name.startsWith('_'));
  
  for (const folder of folders) {
    const metadataPath = path.join(PROCESSED_DIR, folder.name, '.person_metadata.json');
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataContent);
      
      if (docNumber && metadata.docNumbers && metadata.docNumbers.includes(docNumber)) {
        return path.join(PROCESSED_DIR, folder.name);
      }
      
      const folderBaseName = folder.name.split('_').slice(0, -1).join('_');
      const fn = (folderBaseName || folder.name).replace(/_/g, ' ').toUpperCase();
      const nn = normalizedName.replace(/_/g, ' ');
      const w1 = fn.split(' ').filter(w => w.length > 0);
      const w2 = nn.split(' ').filter(w => w.length > 0);
      const common = w1.filter(w => w2.includes(w)).length;
      const similarity = common / Math.max(w1.length, w2.length);
      
      if (similarity > 0.7 && dob && metadata.dob === dob) {
        if (docNumber && !metadata.docNumbers.includes(docNumber)) {
          metadata.docNumbers.push(docNumber);
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        }
        return path.join(PROCESSED_DIR, folder.name);
      }
    } catch (err) {
      continue;
    }
  }
  
  let folderSuffix = '';
  const baseNormalizedName = normalizedName;
  let counter = 0;
  
  for (const folder of folders) {
    const folderBaseName = folder.name.split('_').slice(0, -1).join('_');
    const fn = (folderBaseName || folder.name).replace(/_/g, ' ').toUpperCase();
    const nn = normalizedName.replace(/_/g, ' ');
    const w1 = fn.split(' ').filter(w => w.length > 0);
    const w2 = nn.split(' ').filter(w => w.length > 0);
    const common = w1.filter(w => w2.includes(w)).length;
    const similarity = common / Math.max(w1.length, w2.length);
    
    if (similarity > 0.7) {
      counter++;
    }
  }
  
  if (docNumber && docNumber.length >= 4) {
    folderSuffix = docNumber.slice(-4);
  } else if (dob) {
    const dobParts = dob.split('/');
    if (dobParts.length === 3) {
      folderSuffix = dobParts[2];
    }
  }
  
  if (!folderSuffix && counter > 0) {
    folderSuffix = (counter + 1).toString();
  }
  
  const newFolderName = folderSuffix ? `${baseNormalizedName}_${folderSuffix}` : baseNormalizedName;
  const newFolder = path.join(PROCESSED_DIR, newFolderName);
  await fs.mkdir(newFolder, { recursive: true });
  
  const metadata = {
    name: normalizedName.replace(/_/g, ' '),
    docNumbers: docNumber ? [docNumber] : [],
    dob: dob || null,
    created: new Date().toISOString()
  };
  await fs.writeFile(
    path.join(newFolder, '.person_metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  
  return newFolder;
}

// ============ PROCESS SINGLE FILE HELPER ============
async function processSingleFile(filePath, fileName, index, total) {
  if (shouldStop) {
    throw new Error('Processing stopped by user');
  }

  const progressMsg = total > 1 ? `[${index}/${total}] ` : '';
  mainWindow.webContents.send('status-update', `${progressMsg}Processing: ${fileName}...`);
  mainWindow.webContents.send('timeline-add', { 
    fileName, 
    status: 'processing', 
    timestamp: new Date().toISOString() 
  });

  try {
    const result = await extractWithGemini(filePath);
    
    const indexData = await loadIndex();
    const isDuplicate = indexData.documents.find(d => 
      d.name === result.name && 
      d.docType === result.docType && 
      d.docNumber === result.docNumber
    );
    
    if (isDuplicate) {
      mainWindow.webContents.send('timeline-update', { 
        fileName, 
        status: 'duplicate', 
        message: 'Already exists',
        timestamp: new Date().toISOString() 
      });
      return { status: 'duplicate' };
    }
    
    const normalized = result.name.toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, '_');
    const personFolder = await findOrCreatePersonFolder(normalized, result.docNumber, result.dob);
    
    const destPath = path.join(personFolder, fileName);
    await fs.copyFile(filePath, destPath);
    
    const metadata = {
      fileName,
      filePath: destPath,
      personFolder: path.basename(personFolder),
      processedDate: new Date().toISOString(),
      docType: result.docType,
      name: result.name,
      docNumber: result.docNumber,
      dob: result.dob,
      gender: result.gender
    };
    
    await fs.writeFile(
      path.join(personFolder, `${fileName}.json`),
      JSON.stringify(metadata, null, 2)
    );
    await addToIndex(metadata);

    mainWindow.webContents.send('timeline-update', { 
      fileName, 
      status: 'success', 
      message: `${result.name} - ${result.docType}`,
      timestamp: new Date().toISOString() 
    });
    
    return { status: 'success', result };
  } catch (error) {
    console.error('Processing error:', error);
    await fs.mkdir(FAILED_DIR, { recursive: true });
    await fs.copyFile(filePath, path.join(FAILED_DIR, fileName));
    
    mainWindow.webContents.send('timeline-update', { 
      fileName, 
      status: 'failed', 
      message: error.message,
      timestamp: new Date().toISOString() 
    });
    
    return { status: 'failed', error: error.message };
  }
}

// ============ PROCESS SINGLE FILE ============
ipcMain.handle('process-document', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });

  if (canceled || !filePaths?.length) return { success: false };

  isProcessing = true;
  shouldStop = false;
  mainWindow.webContents.send('processing-started');

  const filePath = filePaths[0];
  const fileName = path.basename(filePath);

  const result = await processSingleFile(filePath, fileName, 1, 1);
  
  isProcessing = false;
  mainWindow.webContents.send('processing-finished');
  
  return { success: result.status === 'success', ...result };
});

// ============ PROCESS MULTIPLE FILES ============
ipcMain.handle('process-multiple', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });

  if (canceled || !filePaths?.length) return { success: false };

  isProcessing = true;
  shouldStop = false;
  mainWindow.webContents.send('processing-started');

  let success = 0, failed = 0, duplicates = 0;
  const total = filePaths.length;

  for (let i = 0; i < filePaths.length; i++) {
    if (shouldStop) break;

    const filePath = filePaths[i];
    const fileName = path.basename(filePath);
    
    const result = await processSingleFile(filePath, fileName, i + 1, total);
    
    if (result.status === 'success') success++;
    else if (result.status === 'duplicate') duplicates++;
    else if (result.status === 'failed') failed++;
  }

  const msg = shouldStop 
    ? `Stopped! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`
    : `Done! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`;
  
  mainWindow.webContents.send('status-update', msg);
  isProcessing = false;
  mainWindow.webContents.send('processing-finished');
  
  return { success: true, message: msg, stats: { success, duplicates, failed } };
});

// ============ PROCESS FOLDER ============
ipcMain.handle('process-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ 
    properties: ['openDirectory'] 
  });
  
  if (canceled || !filePaths?.length) return { success: false };

  isProcessing = true;
  shouldStop = false;
  mainWindow.webContents.send('processing-started');

  const folderPath = filePaths[0];
  const allFiles = await fs.readdir(folderPath);
  const imageFiles = allFiles.filter(f => /\.(png|jpg|jpeg)$/i.test(f));

  let success = 0, failed = 0, duplicates = 0;
  const total = imageFiles.length;

  for (let i = 0; i < imageFiles.length; i++) {
    if (shouldStop) break;

    const file = imageFiles[i];
    const filePath = path.join(folderPath, file);
    
    const result = await processSingleFile(filePath, file, i + 1, total);
    
    if (result.status === 'success') success++;
    else if (result.status === 'duplicate') duplicates++;
    else if (result.status === 'failed') failed++;
  }

  const msg = shouldStop 
    ? `Stopped! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`
    : `Done! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`;
  
  mainWindow.webContents.send('status-update', msg);
  isProcessing = false;
  mainWindow.webContents.send('processing-finished');
  
  return { success: true, message: msg, stats: { success, duplicates, failed } };
});

// ============ DRAG AND DROP ============
ipcMain.handle('process-dropped-files', async (event, filePaths) => {
  if (!filePaths?.length) return { success: false };

  const imageFiles = filePaths.filter(f => /\.(png|jpg|jpeg)$/i.test(f));
  if (!imageFiles.length) {
    return { success: false, message: 'No valid image files found' };
  }

  isProcessing = true;
  shouldStop = false;
  mainWindow.webContents.send('processing-started');

  let success = 0, failed = 0, duplicates = 0;
  const total = imageFiles.length;

  for (let i = 0; i < imageFiles.length; i++) {
    if (shouldStop) break;

    const filePath = imageFiles[i];
    const fileName = path.basename(filePath);
    
    const result = await processSingleFile(filePath, fileName, i + 1, total);
    
    if (result.status === 'success') success++;
    else if (result.status === 'duplicate') duplicates++;
    else if (result.status === 'failed') failed++;
  }

  const msg = shouldStop 
    ? `Stopped! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`
    : `Done! ✓ ${success} | ⚠ ${duplicates} duplicates | ✗ ${failed} failed`;
  
  mainWindow.webContents.send('status-update', msg);
  isProcessing = false;
  mainWindow.webContents.send('processing-finished');
  
  return { success: true, message: msg, stats: { success, duplicates, failed } };
});

// ============ STOP PROCESSING ============
ipcMain.handle('stop-processing', async () => {
  shouldStop = true;
  return { success: true };
});

// ============ SEARCH ============
ipcMain.handle('search-documents', async (event, query) => {
  const index = await loadIndex();
  const q = query.toLowerCase();
  const results = index.documents.filter(d =>
    d.name?.toLowerCase().includes(q) ||
    d.docType?.toLowerCase().includes(q) ||
    d.docNumber?.toLowerCase().includes(q)
  );
  return { success: true, results };
});

ipcMain.handle('get-all-documents', async () => {
  const index = await loadIndex();
  return { success: true, documents: index.documents };
});

ipcMain.handle('open-document', async (event, filePath) => {
  await shell.openPath(filePath);
  return { success: true };
});

ipcMain.handle('open-person-folder', async (event, filePath) => {
  const folderPath = path.dirname(filePath);
  await shell.openPath(folderPath);
  return { success: true };
});

ipcMain.handle('open-folder', async () => {
  await shell.openPath(PROCESSED_DIR);
  return { success: true };
});