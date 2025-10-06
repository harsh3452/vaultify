// ============ PROCESSING FUNCTIONS ============
async function processFile() {
  await window.electronAPI.processDocument();
  refresh();
}

async function processMultiple() {
  await window.electronAPI.processMultiple();
  refresh();
}

async function processFolder() {
  await window.electronAPI.processFolder();
  refresh();
}

async function stopProcessing() {
  await window.electronAPI.stopProcessing();
  document.getElementById('status').textContent = 'Stopping after current file...';
}

async function openFolder() {
  await window.electronAPI.openFolder();
}

// ============ SEARCH & DISPLAY ============
async function search() {
  const query = document.getElementById('search-box').value;
  if (query.length < 2) {
    refresh();
    return;
  }
  const result = await window.electronAPI.searchDocuments(query);
  if (result.success) displayResults(result.results);
}

async function refresh() {
  const result = await window.electronAPI.getAllDocuments();
  if (result.success) displayResults(result.documents);
}

function displayResults(docs) {
  const resultsDiv = document.getElementById('results');
  
  if (docs.length === 0) {
    resultsDiv.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <h3>No documents yet</h3>
        <p>Process some files to get started</p>
      </div>
    `;
    return;
  }
  
  resultsDiv.innerHTML = docs.map(doc => `
    <div class="doc-card">
      <div class="doc-preview" style="background-image: url('file:///${doc.filePath.replace(/\\/g, '/')}');" onclick="openDoc('${doc.filePath.replace(/\\/g, '\\\\')}')"></div>
      <span class="doc-type">${doc.docType || 'UNKNOWN'}</span>
      <div class="doc-name">${doc.name || 'No name'}</div>
      <div class="doc-number">${doc.docNumber || 'No number'}</div>
      <div class="doc-meta">
        ${doc.gender || ''} ${doc.dob ? '| ' + doc.dob : ''}<br>
        Folder: ${doc.personFolder}<br>
        📅 ${new Date(doc.processedDate).toLocaleDateString()}
      </div>
      <div class="doc-actions">
        <button class="action-btn" onclick="event.stopPropagation(); openDoc('${doc.filePath.replace(/\\/g, '\\\\')}')">
          📄 Open File
        </button>
        <button class="action-btn folder-btn" onclick="event.stopPropagation(); openPersonFolder('${doc.filePath.replace(/\\/g, '\\\\')}')">
          📂 Open Folder
        </button>
      </div>
    </div>
  `).join('');
}

async function openDoc(filePath) {
  await window.electronAPI.openDocument(filePath);
}

async function openPersonFolder(filePath) {
  await window.electronAPI.openPersonFolder(filePath);
}

// ============ TIMELINE MANAGEMENT ============
const timelineItems = new Map();

function addTimelineItem(data) {
  const timeline = document.getElementById('timeline');
  
  // Remove "no activity" message if exists
  if (timeline.children.length === 1 && timeline.children[0].textContent.includes('No activity')) {
    timeline.innerHTML = '';
  }
  
  const item = document.createElement('div');
  item.className = `timeline-item ${data.status}`;
  item.id = `timeline-${data.fileName}`;
  
  item.innerHTML = `
    <div class="timeline-item-header">
      <div class="timeline-file" title="${data.fileName}">${data.fileName}</div>
      <span class="timeline-status ${data.status}">${data.status}</span>
    </div>
    <div class="timeline-message">${data.message || 'Processing...'}</div>
    <div class="timeline-time">${new Date(data.timestamp).toLocaleTimeString()}</div>
  `;
  
  timeline.insertBefore(item, timeline.firstChild);
  timelineItems.set(data.fileName, item);
  
  // Limit to 50 items
  if (timeline.children.length > 50) {
    const lastItem = timeline.lastChild;
    timelineItems.delete(lastItem.querySelector('.timeline-file').textContent);
    timeline.removeChild(lastItem);
  }
}

function updateTimelineItem(data) {
  const item = timelineItems.get(data.fileName);
  if (!item) return;
  
  item.className = `timeline-item ${data.status}`;
  item.querySelector('.timeline-status').className = `timeline-status ${data.status}`;
  item.querySelector('.timeline-status').textContent = data.status;
  item.querySelector('.timeline-message').textContent = data.message || '';
  item.querySelector('.timeline-time').textContent = new Date(data.timestamp).toLocaleTimeString();
}

function clearTimeline() {
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = `
    <div style="text-align: center; color: #999; padding: 40px 20px;">
      No activity yet
    </div>
  `;
  timelineItems.clear();
}

// ============ DRAG & DROP ============
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
  
  const files = Array.from(e.dataTransfer.files);
  const filePaths = files.map(f => f.path);
  
  if (filePaths.length > 0) {
    await window.electronAPI.processDroppedFiles(filePaths);
    refresh();
  }
});

// Make drop zone clickable to trigger file selection
dropZone.addEventListener('click', (e) => {
  if (e.target === dropZone || e.target.closest('.drop-zone')) {
    processMultiple();
  }
});

// ============ UI STATE MANAGEMENT ============
function setProcessingState(isProcessing) {
  const indicator = document.getElementById('processingIndicator');
  const btnSingle = document.getElementById('btnSingle');
  const btnMultiple = document.getElementById('btnMultiple');
  const btnFolder = document.getElementById('btnFolder');
  const btnStop = document.getElementById('btnStop');
  
  if (isProcessing) {
    indicator.classList.add('active');
    btnSingle.disabled = true;
    btnMultiple.disabled = true;
    btnFolder.disabled = true;
    btnStop.disabled = false;
  } else {
    indicator.classList.remove('active');
    btnSingle.disabled = false;
    btnMultiple.disabled = false;
    btnFolder.disabled = false;
    btnStop.disabled = true;
  }
}

// ============ EVENT LISTENERS ============
window.electronAPI.onStatusUpdate((message) => {
  document.getElementById('status').textContent = message;
});

window.electronAPI.onTimelineAdd((data) => {
  addTimelineItem(data);
});

window.electronAPI.onTimelineUpdate((data) => {
  updateTimelineItem(data);
});

window.electronAPI.onProcessingStarted(() => {
  setProcessingState(true);
});

window.electronAPI.onProcessingFinished(() => {
  setProcessingState(false);
});

// ============ INITIALIZATION ============
window.addEventListener('DOMContentLoaded', () => {
  refresh();
  
  // Prevent default drag & drop on window
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  
  window.addEventListener('drop', (e) => {
    e.preventDefault();
  });
});