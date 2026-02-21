import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { 
  Folder, FileText, Search, Upload, Home, 
  Grid, Clock, Star, HardDrive, ChevronRight, User, LogOut,
  X, Download, Trash2, FileImage, FileType, CheckCircle, Loader, CloudUpload,
  RotateCcw, RotateCw // <--- NEW ICONS IMPORTED
} from 'lucide-react';

// --- COMPONENT: LANDING PAGE ---
const LandingPage = ({ onEnter }) => {
  return (
    <div className="landing-container">
      <div className="landing-content">
        <div className="landing-logo">
          <HardDrive size={64} color="#3b82f6" />
          <h1 className="landing-title">VAULTIFY</h1>
        </div>
        <p className="landing-subtitle">
          Intelligent Document Sorting & Compression System
        </p>
        <button className="enter-btn" onClick={onEnter}>
          Launch Dashboard <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
};

// --- COMPONENT: UPLOAD PROGRESS MODAL ---
const UploadModal = ({ progress, status }) => {
  return (
    <div className="modal-overlay">
      <div className="upload-modal-content">
        <div className="upload-icon-wrapper">
          <CloudUpload size={40} color="#3b82f6" />
        </div>
        <h2 style={{margin:0}}>Processing Files</h2>
        <div style={{width:'100%'}}>
          <div className="progress-container">
            <div className="progress-fill-animated" style={{width: `${progress}%`}}></div>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', marginTop: 8}}>
            <span className="status-text">{status}</span>
            <span style={{color:'#94a3b8'}}>{progress}%</span>
          </div>
        </div>
        <p className="sub-status-text">
          Please wait while Vaultify sorts and compresses your documents.
        </p>
      </div>
    </div>
  );
};

// --- COMPONENT: PREVIEW MODAL (UPDATED WITH ROTATION) ---
const PreviewModal = ({ file, clientName, onClose, onRefresh }) => {
  const [format, setFormat] = useState('pdf'); 
  const [version, setVersion] = useState('compressed'); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // 🆕 ROTATION STATE
  const [rotation, setRotation] = useState(0);

  // 🆕 ROTATION HANDLERS
  const rotateLeft = () => setRotation((prev) => prev - 90);
  const rotateRight = () => setRotation((prev) => prev + 90);

  const handleDownload = async () => {
    setIsProcessing(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + 10));
    }, 700);

    try {
      const targetFile = file.real_filename || file.filename;
      // Note: We don't send rotation to backend, it's just for viewing
      const url = `http://localhost:5000/download?client=${clientName}&type=${file.type}&file=${targetFile}&version=${version}&format=${format}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download Failed");
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ext = format === 'jpg' ? 'jpg' : 'pdf';
      a.download = `${file.filename}_${version}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => setIsProcessing(false), 1000);
      
    } catch (error) {
      alert("Error: " + error.message);
      setIsProcessing(false);
      clearInterval(interval);
    }
  };

  const handleDelete = async () => {
    if(!confirm("Do you want to delete this file? If deleted it cannot be recovered back.")) return;
    try {
      const targetFile = file.real_filename || file.filename + ".jpg";
      const res = await fetch(`http://localhost:5000/delete/${targetFile}`, { method: 'DELETE' });
      if (res.ok) { onClose(); onRefresh(); } 
      else {
        const res2 = await fetch(`http://localhost:5000/delete/${file.filename}`, { method: 'DELETE' });
        if (res2.ok) { onClose(); onRefresh(); } else alert("Delete failed");
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* LEFT: Image Preview (UPDATED WITH ROTATION STYLE) */}
        <div className="modal-preview-side">
          <img 
            src={file.preview_url} 
            alt="Preview" 
            className="modal-image" 
            // 🆕 APPLY CSS TRANSFORM
            style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }}
          />
        </div>

        {/* RIGHT: Controls */}
        <div className="modal-controls-side">
          <div className="modal-header">
            <div>
              <h2 style={{margin:0, fontSize:'1.2rem'}}>{file.filename}</h2>
              <div style={{display:'flex', alignItems:'center'}}>
                  <span className="doc-type-badge">{file.type.replace(/_/g, ' ')}</span>
                  <span className="doc-size-badge">{file.size}</span> 
              </div>
            </div>
            <button className="close-btn" onClick={onClose}><X size={24} /></button>
          </div>

          <div style={{marginTop: '20px'}}>
             {/* Format & Version Toggles */}
            <div className="control-group">
              <span className="toggle-label">Download Options</span>
              
              {/* 🆕 ROTATION CONTROLS ADDED HERE */}
              <div className="rotate-controls" style={{marginTop:0, paddingTop:0, paddingBottom: 15, borderBottom:'1px solid var(--glass-border)', borderTop:'none'}}>
                 <button className="rotate-btn" onClick={rotateLeft} title="Rotate Left 90°">
                   <RotateCcw size={16} /> Rotate Left
                 </button>
                 <button className="rotate-btn" onClick={rotateRight} title="Rotate Right 90°">
                   <RotateCw size={16} /> Rotate Right
                 </button>
              </div>

              <div style={{marginTop: 15}}>
                <span className="toggle-label" style={{fontSize:'0.75rem'}}>Target Format</span>
                <div className="toggle-row">
                  <button className={`toggle-btn ${format === 'pdf' ? 'active' : ''}`} onClick={() => setFormat('pdf')}>
                    <FileType size={16} style={{marginBottom:-2, marginRight:5}}/> PDF
                  </button>
                  <button className={`toggle-btn ${format === 'jpg' ? 'active' : ''}`} onClick={() => setFormat('jpg')}>
                    <FileImage size={16} style={{marginBottom:-2, marginRight:5}}/> JPG
                  </button>
                </div>
              </div>

              <div style={{marginTop: 15}}>
                 <span className="toggle-label" style={{fontSize:'0.75rem'}}>Quality Source</span>
                 <div className="toggle-row">
                  <button className={`toggle-btn ${version === 'compressed' ? 'active' : ''}`} onClick={() => setVersion('compressed')}>
                    Compressed
                  </button>
                  <button className={`toggle-btn ${version === 'original' ? 'active' : ''}`} onClick={() => setVersion('original')}>
                    Original
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={{marginTop: 'auto'}}>
            <button className="action-btn download-btn" onClick={handleDownload} disabled={isProcessing}>
              {isProcessing ? <><Loader size={18} className="animate-spin" /> Reconstructing... {progress}%</> : <><Download size={18} /> Reconstruct & Download</>}
            </button>
            <button className="action-btn delete-btn" onClick={handleDelete}>
              <Trash2 size={18} /> Delete File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT: MAIN APP (Unchanged) ---
function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [viewState, setViewState] = useState('home'); 
  const [selectedClient, setSelectedClient] = useState(null); 
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]); 
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Initializing...");
  const fileInputRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const res = await fetch('http://localhost:5000/documents');
      const data = await res.json();
      setDocuments(data);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  };

  useEffect(() => { fetchDocuments(); }, []);

  const handleUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true); setUploadProgress(0); setUploadStatus("Uploading to Secure Vault...");
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) { formData.append('files', files[i]); }
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev < 30) return prev + 5;
        else if (prev < 60) { setUploadStatus("AI Scanning Document..."); return prev + 2; }
        else if (prev < 85) { setUploadStatus("Compressing & Optimizing..."); return prev + 1; }
        else return prev; 
      });
    }, 200);
    try {
      const res = await fetch('http://localhost:5000/upload', { method: 'POST', body: formData, });
      if (res.ok) {
        clearInterval(progressInterval); setUploadStatus("Sorting Complete!"); setUploadProgress(100);
        setTimeout(() => { setIsUploading(false); alert("Documents processed successfully!"); fetchDocuments(); }, 800);
      }
    } catch (err) { clearInterval(progressInterval); setIsUploading(false); alert("Upload Failed"); }
  };

  const openClientFolder = (client) => { setSelectedClient(client); setViewState('client-view'); };
  const goHome = () => { setViewState('home'); setSelectedClient(null); };

  const renderClientGrid = () => {
    const filteredDocs = documents.filter(doc => doc.client.toLowerCase().includes(searchQuery.toLowerCase()));
    return (
      <div className="grid-container">
        {filteredDocs.map((doc, index) => (
          <div key={index} className="folder-card" onClick={() => openClientFolder(doc)}>
            <Folder size={48} className="folder-icon" />
            <h3>{doc.client.replace(/_/g, ' ')}</h3>
            <p style={{color: '#94a3b8', fontSize: '0.9rem'}}>{doc.documents.length} Files</p>
          </div>
        ))}
      </div>
    );
  };

  const renderFileGrid = () => {
    if (!selectedClient) return null;
    return (
      <div className="grid-container">
        {selectedClient.documents.map((file, index) => (
          <div key={index} className="doc-card" onClick={() => setSelectedFile(file)}>
            <img src={file.preview_url} alt={file.filename} className="doc-preview" onError={(e) => {e.target.src = 'https://via.placeholder.com/150?text=PDF'}} />
            <div className="doc-info">
              <div className="doc-title">{file.filename}</div>
              <span className="doc-type-badge">{file.type.replace(/_/g, ' ')}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (showLanding) return <LandingPage onEnter={() => setShowLanding(false)} />;

  return (
    <div className="dashboard-container">
      <div className="sidebar">
        <div className="logo"><HardDrive color="#3b82f6" size={28} /><span>Vaultify</span></div>
        <button className="upload-btn" onClick={() => fileInputRef.current.click()}><Upload size={18} /> Upload New</button>
        <input type="file" multiple ref={fileInputRef} style={{display: 'none'}} onChange={handleUpload}/>
        <div style={{marginTop: '2rem'}}>
          <div className={`nav-item ${viewState === 'home' ? 'active' : ''}`} onClick={goHome}><Home size={18} /> Home</div>
          <div className="nav-item"><Clock size={18} /> Recent</div>
          <div className="nav-item"><Star size={18} /> Favorites</div>
        </div>
        <div className="user-account">
          <div className="user-avatar"><User size={20} color="white" /></div>
          <div className="user-info"><span className="user-name">Guest User</span><span className="user-status">My Account</span></div>
          <LogOut size={16} className="logout-icon" onClick={() => setShowLanding(true)} />
        </div>
      </div>
      <div className="main-content">
        <div className="top-bar">
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            {viewState === 'client-view' && (<><button onClick={goHome} style={{background:'none', border:'none', color:'#94a3b8', cursor:'pointer'}}>Home</button><ChevronRight size={16} color="#64748b" /><span style={{fontWeight:'600'}}>{selectedClient.client.replace(/_/g, ' ')}</span></>)}
            {viewState === 'home' && <span style={{fontWeight:'600', fontSize:'1.2rem'}}>My Cloud</span>}
          </div>
          <div className="search-bar"><Search size={18} color="#94a3b8" /><input type="text" placeholder="Search files..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
        </div>
        <div className="content-area">
          {loading ? <p style={{color: '#94a3b8'}}>Syncing with Vaultify Brain...</p> : (viewState === 'home' ? renderClientGrid() : renderFileGrid())}
        </div>
      </div>
      {selectedFile && <PreviewModal file={selectedFile} clientName={selectedClient.client} onClose={() => setSelectedFile(null)} onRefresh={fetchDocuments} />}
      {isUploading && <UploadModal progress={uploadProgress} status={uploadStatus} />}
    </div>
  );
}

export default App;