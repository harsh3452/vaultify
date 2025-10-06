const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Processing functions
  processDocument: () => ipcRenderer.invoke('process-document'),
  processMultiple: () => ipcRenderer.invoke('process-multiple'),
  processFolder: () => ipcRenderer.invoke('process-folder'),
  processDroppedFiles: (filePaths) => ipcRenderer.invoke('process-dropped-files', filePaths),
  stopProcessing: () => ipcRenderer.invoke('stop-processing'),
  
  // Search and document management
  searchDocuments: (query) => ipcRenderer.invoke('search-documents', query),
  getAllDocuments: () => ipcRenderer.invoke('get-all-documents'),
  openDocument: (filePath) => ipcRenderer.invoke('open-document', filePath),
  openPersonFolder: (filePath) => ipcRenderer.invoke('open-person-folder', filePath),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  
  // Event listeners
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, message) => callback(message));
  },
  onTimelineAdd: (callback) => {
    ipcRenderer.on('timeline-add', (event, data) => callback(data));
  },
  onTimelineUpdate: (callback) => {
    ipcRenderer.on('timeline-update', (event, data) => callback(data));
  },
  onProcessingStarted: (callback) => {
    ipcRenderer.on('processing-started', () => callback());
  },
  onProcessingFinished: (callback) => {
    ipcRenderer.on('processing-finished', () => callback());
  }
});