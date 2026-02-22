import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Login from './Login';
import Register from './Register';
import Dashboard from './Dashboard';
import {
  Folder, Search, Upload,
  X, Download, Trash2, FileImage, FileType, Loader, CloudUpload,
  RotateCcw, RotateCw, ChevronRight, HardDrive,
  Users, FileText, HardDrive as StorageIcon, AlertTriangle
} from 'lucide-react';

// --- COMPONENT: UPLOAD PROGRESS MODAL ---
const UploadModal = ({ progress, status }) => (
  <div className="modal-overlay">
    <div className="upload-modal-content">
      <div className="upload-icon-wrapper">
        <CloudUpload size={40} color="#00e6c8" />
      </div>
      <h2 style={{ margin: 0 }}>Processing Files</h2>
      <div style={{ width: '100%' }}>
        <div className="progress-container">
          <div className="progress-fill-animated" style={{ width: `${progress}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span className="status-text">{status}</span>
          <span style={{ color: '#94a3b8' }}>{progress}%</span>
        </div>
      </div>
      <p className="sub-status-text">
        Please wait while Vaultify sorts and compresses your documents.
      </p>
    </div>
  </div>
);

// --- COMPONENT: PREVIEW MODAL ---
const PreviewModal = ({ file, clientName, onClose, onRefresh }) => {
  const [format, setFormat] = useState('pdf');
  const [version, setVersion] = useState('compressed');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rotation, setRotation] = useState(0);

  const rotateLeft = () => setRotation(prev => prev - 90);
  const rotateRight = () => setRotation(prev => prev + 90);

  const handleDownload = async () => {
    setIsProcessing(true); setProgress(0);
    const interval = setInterval(() => {
      setProgress(prev => (prev >= 90 ? prev : prev + 10));
    }, 700);
    try {
      const targetFile = file.real_filename || file.filename;
      const url = `http://localhost:8000/download?client=${clientName}&type=${file.type}&file=${targetFile}&version=${version}&format=${format}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download Failed');
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${file.filename}_${version}.${format === 'jpg' ? 'jpg' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      clearInterval(interval); setProgress(100);
      setTimeout(() => setIsProcessing(false), 1000);
    } catch (error) {
      alert('Error: ' + error.message);
      setIsProcessing(false);
      clearInterval(interval);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Do you want to delete this file? This cannot be undone.')) return;
    try {
      const targetFile = file.real_filename || file.filename + '.jpg';
      const res = await fetch(`http://localhost:8000/delete/${targetFile}`, { method: 'DELETE' });
      if (res.ok) { onClose(); onRefresh(); }
      else {
        const res2 = await fetch(`http://localhost:8000/delete/${file.filename}`, { method: 'DELETE' });
        if (res2.ok) { onClose(); onRefresh(); } else alert('Delete failed');
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-preview-side">
          <img
            src={file.preview_url}
            alt="Preview"
            className="modal-image"
            style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }}
          />
        </div>
        <div className="modal-controls-side">
          <div className="modal-header">
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{file.filename}</h2>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
                <span className="doc-type-badge">{file.type.replace(/_/g, ' ')}</span>
                <span className="doc-size-badge">{file.size}</span>
              </div>
            </div>
            <button className="close-btn" onClick={onClose}><X size={22} /></button>
          </div>

          <div style={{ marginTop: '16px' }}>
            <div className="control-group">
              <span className="toggle-label">Download Options</span>
              <div className="rotate-controls" style={{ marginTop: 0, paddingTop: 0, paddingBottom: 12, borderBottom: '1px solid var(--glass-border)', borderTop: 'none' }}>
                <button className="rotate-btn" onClick={rotateLeft}><RotateCcw size={14} /> Rotate Left</button>
                <button className="rotate-btn" onClick={rotateRight}><RotateCw size={14} /> Rotate Right</button>
              </div>
              <div style={{ marginTop: 12 }}>
                <span className="toggle-label" style={{ fontSize: '0.72rem' }}>Target Format</span>
                <div className="toggle-row">
                  <button className={`toggle-btn ${format === 'pdf' ? 'active' : ''}`} onClick={() => setFormat('pdf')}><FileType size={14} style={{ marginRight: 4 }} /> PDF</button>
                  <button className={`toggle-btn ${format === 'jpg' ? 'active' : ''}`} onClick={() => setFormat('jpg')}><FileImage size={14} style={{ marginRight: 4 }} /> JPG</button>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <span className="toggle-label" style={{ fontSize: '0.72rem' }}>Quality Source</span>
                <div className="toggle-row">
                  <button className={`toggle-btn ${version === 'compressed' ? 'active' : ''}`} onClick={() => setVersion('compressed')}>Compressed</button>
                  <button className={`toggle-btn ${version === 'original' ? 'active' : ''}`} onClick={() => setVersion('original')}>Original</button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 'auto' }}>
            <button className="action-btn download-btn" onClick={handleDownload} disabled={isProcessing}>
              {isProcessing ? <><Loader size={16} className="animate-spin" /> Reconstructing... {progress}%</> : <><Download size={16} /> Reconstruct & Download</>}
            </button>
            <button className="action-btn delete-btn" onClick={handleDelete}>
              <Trash2 size={16} /> Delete File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP ---
function App() {
  const [page, setPage] = useState('login');
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [viewState, setViewState] = useState('home');
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('Initializing...');
  const fileInputRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const res = await fetch('http://localhost:8000/documents');
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocuments(); }, []);

  const handleUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true); setUploadProgress(0); setUploadStatus('Uploading to Secure Vault...');
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) formData.append('files', files[i]);
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev < 30) return prev + 5;
        else if (prev < 60) { setUploadStatus('AI Scanning Document...'); return prev + 2; }
        else if (prev < 85) { setUploadStatus('Compressing & Optimizing...'); return prev + 1; }
        else return prev;
      });
    }, 200);
    try {
      const res = await fetch('http://localhost:8000/upload', { method: 'POST', body: formData });
      if (res.ok) {
        clearInterval(interval); setUploadStatus('Sorting Complete!'); setUploadProgress(100);
        setTimeout(() => { setIsUploading(false); alert('Documents processed successfully!'); fetchDocuments(); }, 800);
      }
    } catch {
      clearInterval(interval); setIsUploading(false); alert('Upload Failed');
    }
  };

  const openClientFolder = (client) => { setSelectedClient(client); setViewState('client-view'); };
  const goHome = () => { setViewState('home'); setSelectedClient(null); };

  // Stats derived from documents
  const totalDocs = documents.reduce((acc, d) => acc + d.documents.length, 0);
  const totalClients = documents.length;

  const renderClientGrid = () => {
    const filtered = documents.filter(d => d.client.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!filtered.length) return (
      <div className="dash-empty">
        <HardDrive size={48} />
        <p>No client folders yet. Upload some documents to get started.</p>
      </div>
    );
    return (
      <div className="dash-grid">
        {filtered.map((doc, i) => (
          <div key={i} className="dash-folder-card" onClick={() => openClientFolder(doc)}>
            <Folder size={44} className="dash-folder-icon" />
            <div className="dash-folder-name">{doc.client.replace(/_/g, ' ')}</div>
            <div className="dash-folder-count">{doc.documents.length} Files</div>
          </div>
        ))}
      </div>
    );
  };

  const renderFileGrid = () => {
    if (!selectedClient) return null;
    return (
      <div className="dash-grid">
        {selectedClient.documents.map((file, i) => (
          <div key={i} className="dash-doc-card" onClick={() => setSelectedFile(file)}>
            <img
              src={file.preview_url}
              alt={file.filename}
              className="dash-doc-preview"
              onError={e => { e.target.src = 'https://via.placeholder.com/150?text=DOC'; }}
            />
            <div className="dash-doc-info">
              <div className="dash-doc-title">{file.filename}</div>
              <span className="dash-badge">{file.type.replace(/_/g, ' ')}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (page === 'login') return <Login onLogin={(u) => { setFirebaseUser(u); setPage('dashboard'); }} onGoRegister={() => setPage('register')} />;
  if (page === 'register') return <Register onGoLogin={() => setPage('login')} />;

  return (
    <Dashboard
      activeView={viewState}
      onNavigate={(view) => { setViewState(view); setSelectedClient(null); }}
      onUpload={() => fileInputRef.current.click()}
      onLogout={() => { localStorage.removeItem('vaultify_token'); localStorage.removeItem('vaultify_user'); setPage('login'); }}
      user={firebaseUser ? { name: firebaseUser.displayName, email: firebaseUser.email } : null}
    >
      {/* Hidden file input */}
      <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleUpload} />

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon-wrap"><Users size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{totalClients}</span>
            <span className="stat-label">Total Clients</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrap"><FileText size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{totalDocs}</span>
            <span className="stat-label">Total Documents</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrap"><StorageIcon size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">—</span>
            <span className="stat-label">Storage Used</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrap"><AlertTriangle size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">—</span>
            <span className="stat-label">Needs Review</span>
          </div>
        </div>
      </div>

      {/* Content Header */}
      <div className="content-header">
        <div className="breadcrumb">
          {viewState === 'client-view' ? (
            <>
              <button onClick={goHome}>Home</button>
              <ChevronRight size={14} />
              <span className="breadcrumb-current">{selectedClient?.client.replace(/_/g, ' ')}</span>
            </>
          ) : (
            <span className="breadcrumb-current">My Cloud</span>
          )}
        </div>
        <div className="dash-search">
          <Search size={16} className="dash-search-icon" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Grid */}
      {loading
        ? <div className="dash-empty"><p style={{ color: 'var(--ds-muted)' }}>Syncing with Vaultify Brain...</p></div>
        : (viewState === 'home' ? renderClientGrid() : renderFileGrid())
      }

      {/* Modals */}
      {selectedFile && (
        <PreviewModal
          file={selectedFile}
          clientName={selectedClient?.client}
          onClose={() => setSelectedFile(null)}
          onRefresh={fetchDocuments}
        />
      )}
      {isUploading && <UploadModal progress={uploadProgress} status={uploadStatus} />}
    </Dashboard>
  );
}

export default App;