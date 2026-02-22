import React, { useState, useRef, useCallback } from 'react';
import './Upload.css';
import {
    ImageIcon, FolderOpen, Upload, X, CheckCircle,
    Loader, FileImage, AlertCircle, ListTodo
} from 'lucide-react';

/* ─────── helpers ─────── */
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const isImage = (file) => file.type.startsWith('image/');

/* ─────── main component ─────── */
const UploadPage = ({ onUploadSuccess }) => {
    const [queue, setQueue] = useState([]);          // { file, preview, status }
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [toast, setToast] = useState(false);
    const [dragOverImages, setDragOverImages] = useState(false);
    const [dragOverFolder, setDragOverFolder] = useState(false);

    const imagesInputRef = useRef(null);
    const folderInputRef = useRef(null);

    /* ── add files to queue (deduplicate by name+size) ── */
    const addFilesToQueue = useCallback((files) => {
        const incoming = Array.from(files).filter(f =>
            isImage(f) || f.type === 'application/pdf'
        );
        setQueue(prev => {
            const existingKeys = new Set(prev.map(q => q.file.name + q.file.size));
            const newItems = incoming
                .filter(f => !existingKeys.has(f.name + f.size))
                .map(f => ({
                    file: f,
                    preview: isImage(f) ? URL.createObjectURL(f) : null,
                    status: 'pending',   // pending | done | error
                }));
            return [...prev, ...newItems];
        });
    }, []);

    /* ── triggers ── */
    const handleImagesChange = (e) => { addFilesToQueue(e.target.files); e.target.value = ''; };
    const handleFolderChange = (e) => { addFilesToQueue(e.target.files); e.target.value = ''; };

    /* ── drag-drop (images zone) ── */
    const handleDragImages = {
        onDragOver: (e) => { e.preventDefault(); setDragOverImages(true); },
        onDragLeave: () => setDragOverImages(false),
        onDrop: (e) => {
            e.preventDefault(); setDragOverImages(false);
            addFilesToQueue(e.dataTransfer.files);
        },
    };

    /* ── drag-drop (folder zone) ── */
    const handleDragFolder = {
        onDragOver: (e) => { e.preventDefault(); setDragOverFolder(true); },
        onDragLeave: () => setDragOverFolder(false),
        onDrop: (e) => {
            e.preventDefault(); setDragOverFolder(false);
            addFilesToQueue(e.dataTransfer.files);
        },
    };

    /* ── remove single item ── */
    const removeItem = (idx) => {
        setQueue(prev => {
            const item = prev[idx];
            if (item.preview) URL.revokeObjectURL(item.preview);
            return prev.filter((_, i) => i !== idx);
        });
    };

    /* ── clear queue ── */
    const clearQueue = () => {
        queue.forEach(q => { if (q.preview) URL.revokeObjectURL(q.preview); });
        setQueue([]);
    };

    /* ── upload ── */
    const handleUpload = async () => {
        const pending = queue.filter(q => q.status === 'pending');
        if (!pending.length) return;

        setUploading(true);
        setProgress(0);
        setStatusText('Uploading to Secure Vault...');

        const formData = new FormData();
        pending.forEach(q => formData.append('files', q.file));

        // animated progress
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev < 30) return prev + 5;
                if (prev < 60) { setStatusText('AI Scanning Documents...'); return prev + 2; }
                if (prev < 85) { setStatusText('Compressing & Optimizing...'); return prev + 1; }
                return prev;
            });
        }, 200);

        try {
            const res = await fetch('http://localhost:8000/upload', {
                method: 'POST',
                body: formData,
            });

            clearInterval(interval);

            if (res.ok) {
                setProgress(100);
                setStatusText('Upload Complete!');
                setQueue(prev => prev.map(q =>
                    q.status === 'pending' ? { ...q, status: 'done' } : q
                ));
                setToast(true);
                setTimeout(() => setToast(false), 3200);
                if (onUploadSuccess) onUploadSuccess();
            } else {
                setStatusText('Upload failed. Please try again.');
                setQueue(prev => prev.map(q =>
                    q.status === 'pending' ? { ...q, status: 'error' } : q
                ));
            }
        } catch {
            clearInterval(interval);
            setStatusText('Network error. Check your connection.');
            setQueue(prev => prev.map(q =>
                q.status === 'pending' ? { ...q, status: 'error' } : q
            ));
        } finally {
            setTimeout(() => { setUploading(false); setProgress(0); setStatusText(''); }, 1200);
        }
    };

    const pendingCount = queue.filter(q => q.status === 'pending').length;

    return (
        <div className="upload-page">

            {/* ── Header ── */}
            <div className="upload-page-header">
                <h1 className="upload-page-title">Upload Documents</h1>
                <p className="upload-page-sub">
                    Select individual images or an entire folder — Vaultify will scan, compress and sort them automatically.
                </p>
            </div>

            {/* ── Two Drop Zones ── */}
            <div className="upload-options-row">

                {/* Zone 1: Select Images */}
                <div
                    className={`upload-zone-card ${dragOverImages ? 'drag-over' : ''}`}
                    onClick={() => imagesInputRef.current.click()}
                    {...handleDragImages}
                >
                    <div className="zone-icon-wrap">
                        <ImageIcon size={28} />
                    </div>
                    <span className="zone-label">Select Images</span>
                    <p className="zone-hint">
                        Click to pick one or more image files<br />
                        (JPG, PNG, WEBP, etc.)
                    </p>
                    <span className="zone-badge">
                        <Upload size={11} /> Click or Drag & Drop
                    </span>
                    <input
                        ref={imagesInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        style={{ display: 'none' }}
                        onChange={handleImagesChange}
                    />
                </div>

                {/* Zone 2: Select Folder */}
                <div
                    className={`upload-zone-card ${dragOverFolder ? 'drag-over' : ''}`}
                    onClick={() => folderInputRef.current.click()}
                    {...handleDragFolder}
                >
                    <div className="zone-icon-wrap">
                        <FolderOpen size={28} />
                    </div>
                    <span className="zone-label">Select Folder</span>
                    <p className="zone-hint">
                        Pick an entire folder — every<br />
                        image inside will be queued.
                    </p>
                    <span className="zone-badge">
                        <FolderOpen size={11} /> Browse Folder
                    </span>
                    <input
                        ref={folderInputRef}
                        type="file"
                        /* webkitdirectory lets the browser expose a folder picker */
                        webkitdirectory=""
                        mozdirectory=""
                        directory=""
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFolderChange}
                    />
                </div>
            </div>

            {/* ── Queue Panel ── */}
            <div className="upload-queue-panel">
                <div className="queue-panel-header">
                    <div className="queue-panel-title">
                        <ListTodo size={16} />
                        Upload Queue
                        {queue.length > 0 && (
                            <span className="queue-count-badge">{queue.length}</span>
                        )}
                    </div>
                    <div className="queue-actions">
                        {queue.length > 0 && (
                            <button className="queue-clear-btn" onClick={clearQueue} disabled={uploading}>
                                <X size={13} /> Clear All
                            </button>
                        )}
                        <button
                            className="queue-upload-btn"
                            onClick={handleUpload}
                            disabled={uploading || pendingCount === 0}
                        >
                            {uploading
                                ? <><Loader size={14} className="animate-spin" /> Uploading…</>
                                : <><Upload size={14} /> Upload {pendingCount > 0 ? `(${pendingCount})` : ''}</>
                            }
                        </button>
                    </div>
                </div>

                {/* File list */}
                {queue.length === 0 ? (
                    <div className="queue-empty-state">
                        <FileImage size={36} />
                        <span>No files queued yet — use the zones above to add files.</span>
                    </div>
                ) : (
                    <div className="queue-file-list">
                        {queue.map((item, idx) => (
                            <div className="queue-file-item" key={idx}>
                                {item.preview
                                    ? <img src={item.preview} alt={item.file.name} className="queue-file-thumb" />
                                    : (
                                        <div className="queue-file-thumb-icon">
                                            <FileImage size={20} />
                                        </div>
                                    )
                                }
                                <div className="queue-file-info">
                                    <div className="queue-file-name">{item.file.name}</div>
                                    <div className="queue-file-meta">
                                        {formatBytes(item.file.size)}
                                        {item.file.webkitRelativePath
                                            ? ` · 📁 ${item.file.webkitRelativePath.split('/').slice(0, -1).join('/')}`
                                            : ''}
                                    </div>
                                </div>
                                <span className={`queue-file-status ${item.status}`}>
                                    {item.status === 'pending' && 'Ready'}
                                    {item.status === 'done' && '✓ Done'}
                                    {item.status === 'error' && '✗ Failed'}
                                </span>
                                {item.status === 'pending' && (
                                    <button
                                        className="queue-file-remove"
                                        onClick={() => removeItem(idx)}
                                        disabled={uploading}
                                        title="Remove from queue"
                                    >
                                        <X size={15} />
                                    </button>
                                )}
                                {item.status === 'done' && <CheckCircle size={16} color="#22c55e" />}
                                {item.status === 'error' && <AlertCircle size={16} color="#ef4444" />}
                            </div>
                        ))}
                    </div>
                )}

                {/* Inline progress bar shown while uploading */}
                {uploading && (
                    <div className="upload-progress-bar-wrap">
                        <div className="upload-progress-label">
                            <strong>{statusText}</strong>
                            <span>{progress}%</span>
                        </div>
                        <div className="upload-progress-track">
                            <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Success Toast ── */}
            {toast && (
                <div className="upload-toast">
                    <CheckCircle size={18} />
                    Documents uploaded &amp; processed successfully!
                </div>
            )}
        </div>
    );
};

export default UploadPage;
