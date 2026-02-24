import React, { useState, useRef, useCallback } from "react";
import {
  ImageIcon,
  FolderOpen,
  Upload,
  X,
  CheckCircle,
  Loader,
  FileImage,
  AlertCircle,
  ListTodo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";

const formatBytes = (bytes) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const isImage = (file) => file.type.startsWith("image/");

const UploadPage = ({ onUploadSuccess }) => {
  const [queue, setQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [toast, setToast] = useState(false);
  const [dragOverImages, setDragOverImages] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState(false);

  const imagesInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const addFilesToQueue = useCallback((files) => {
    const incoming = Array.from(files).filter(
      (f) => isImage(f) || f.type === "application/pdf"
    );
    setQueue((prev) => {
      const existingKeys = new Set(prev.map((q) => q.file.name + q.file.size));
      const newItems = incoming
        .filter((f) => !existingKeys.has(f.name + f.size))
        .map((f) => ({
          file: f,
          preview: isImage(f) ? URL.createObjectURL(f) : null,
          status: "pending",
        }));
      return [...prev, ...newItems];
    });
  }, []);

  const handleImagesChange = (e) => {
    addFilesToQueue(e.target.files);
    e.target.value = "";
  };
  const handleFolderChange = (e) => {
    addFilesToQueue(e.target.files);
    e.target.value = "";
  };

  const handleDragImages = {
    onDragOver: (e) => {
      e.preventDefault();
      setDragOverImages(true);
    },
    onDragLeave: () => setDragOverImages(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOverImages(false);
      addFilesToQueue(e.dataTransfer.files);
    },
  };

  const handleDragFolder = {
    onDragOver: (e) => {
      e.preventDefault();
      setDragOverFolder(true);
    },
    onDragLeave: () => setDragOverFolder(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOverFolder(false);
      addFilesToQueue(e.dataTransfer.files);
    },
  };

  const removeItem = (idx) => {
    setQueue((prev) => {
      const item = prev[idx];
      if (item.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearQueue = () => {
    queue.forEach((q) => {
      if (q.preview) URL.revokeObjectURL(q.preview);
    });
    setQueue([]);
  };

  const handleUpload = async () => {
    const pending = queue.filter((q) => q.status === "pending");
    if (!pending.length) return;

    setUploading(true);
    setProgress(0);
    setStatusText("Uploading to Secure Vault...");

    const formData = new FormData();
    pending.forEach((q) => formData.append("files", q.file));

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 30) return prev + 5;
        if (prev < 60) {
          setStatusText("AI Scanning Documents...");
          return prev + 2;
        }
        if (prev < 85) {
          setStatusText("Compressing & Optimizing...");
          return prev + 1;
        }
        return prev;
      });
    }, 200);

    try {
      const res = await authFetch(`${API}/upload`, {
        method: "POST",
        body: formData,
      });

      clearInterval(interval);

      if (res.ok) {
        setProgress(100);
        setStatusText("Upload Complete!");
        setQueue((prev) =>
          prev.map((q) =>
            q.status === "pending" ? { ...q, status: "done" } : q
          )
        );
        setToast(true);
        setTimeout(() => setToast(false), 3200);
        if (onUploadSuccess) onUploadSuccess();
      } else {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || `Upload failed (${res.status})`;
        setStatusText(msg);
        setQueue((prev) =>
          prev.map((q) =>
            q.status === "pending" ? { ...q, status: "error" } : q
          )
        );
      }
    } catch {
      clearInterval(interval);
      setStatusText("Network error. Check your connection.");
      setQueue((prev) =>
        prev.map((q) =>
          q.status === "pending" ? { ...q, status: "error" } : q
        )
      );
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setStatusText("");
      }, 1200);
    }
  };

  const pendingCount = queue.filter((q) => q.status === "pending").length;

  return (
    <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-4 fade-in duration-400">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Upload Documents
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select individual images or an entire folder — Vaultify will scan,
          compress and sort them automatically.
        </p>
      </div>

      {/* Drop Zones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Zone: Select Images */}
        <div
          className={`relative flex flex-col items-center justify-center gap-4 p-10 min-h-[230px] rounded-2xl border-2 border-dashed cursor-pointer transition-all 
            ${
              dragOverImages
                ? "border-primary bg-primary/5 shadow-lg -translate-y-0.5"
                : "border-border bg-card hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5"
            }`}
          onClick={() => imagesInputRef.current.click()}
          {...handleDragImages}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-border flex items-center justify-center text-primary transition-transform group-hover:scale-105">
            <ImageIcon size={28} />
          </div>
          <span className="font-bold text-foreground">Select Images</span>
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Click to pick one or more image files
            <br />
            (JPG, PNG, WEBP, etc.)
          </p>
          <Badge variant="secondary" className="gap-1.5">
            <Upload size={11} /> Click or Drag & Drop
          </Badge>
          <input
            ref={imagesInputRef}
            type="file"
            multiple
            accept="image/*,.pdf"
            className="hidden"
            onChange={handleImagesChange}
          />
        </div>

        {/* Zone: Select Folder */}
        <div
          className={`relative flex flex-col items-center justify-center gap-4 p-10 min-h-[230px] rounded-2xl border-2 border-dashed cursor-pointer transition-all 
            ${
              dragOverFolder
                ? "border-primary bg-primary/5 shadow-lg -translate-y-0.5"
                : "border-border bg-card hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5"
            }`}
          onClick={() => folderInputRef.current.click()}
          {...handleDragFolder}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-border flex items-center justify-center text-primary">
            <FolderOpen size={28} />
          </div>
          <span className="font-bold text-foreground">Select Folder</span>
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Pick an entire folder — every
            <br />
            image inside will be queued.
          </p>
          <Badge variant="secondary" className="gap-1.5">
            <FolderOpen size={11} /> Browse Folder
          </Badge>
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory=""
            mozdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={handleFolderChange}
          />
        </div>
      </div>

      {/* Queue Panel */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden backdrop-blur-xl">
        {/* Queue header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-primary/5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ListTodo size={16} />
            Upload Queue
            {queue.length > 0 && (
              <Badge className="ml-1">{queue.length}</Badge>
            )}
          </div>
          <div className="flex gap-2">
            {queue.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearQueue}
                disabled={uploading}
                className="text-xs"
              >
                <X size={13} /> Clear All
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={uploading || pendingCount === 0}
              className="text-xs"
            >
              {uploading ? (
                <>
                  <Loader size={14} className="animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <Upload size={14} /> Upload{" "}
                  {pendingCount > 0 ? `(${pendingCount})` : ""}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* File list */}
        {queue.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground text-sm">
            <FileImage size={36} className="opacity-30" />
            <span>No files queued yet — use the zones above to add files.</span>
          </div>
        ) : (
          <div className="max-h-[340px] overflow-y-auto">
            {queue.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-5 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
              >
                {item.preview ? (
                  <img
                    src={item.preview}
                    alt={item.file.name}
                    className="w-11 h-11 rounded-lg object-cover bg-primary/10 border border-border shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-primary/10 border border-border flex items-center justify-center text-primary shrink-0">
                    <FileImage size={20} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {item.file.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatBytes(item.file.size)}
                    {item.file.webkitRelativePath
                      ? ` · 📁 ${item.file.webkitRelativePath.split("/").slice(0, -1).join("/")}`
                      : ""}
                  </div>
                </div>
                <Badge
                  variant={
                    item.status === "done"
                      ? "default"
                      : item.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                  className={
                    item.status === "done"
                      ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                      : ""
                  }
                >
                  {item.status === "pending" && "Ready"}
                  {item.status === "done" && "✓ Done"}
                  {item.status === "error" && "✗ Failed"}
                </Badge>
                {item.status === "pending" && (
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                    onClick={() => removeItem(idx)}
                    disabled={uploading}
                  >
                    <X size={15} />
                  </button>
                )}
                {item.status === "done" && (
                  <CheckCircle size={16} className="text-green-500 shrink-0" />
                )}
                {item.status === "error" && (
                  <AlertCircle
                    size={16}
                    className="text-destructive shrink-0"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {uploading && (
          <div className="px-5 py-3 border-t border-border bg-primary/5">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <strong className="text-primary">{statusText}</strong>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-teal-400 rounded-full transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 right-8 flex items-center gap-2.5 bg-card/95 border border-green-500/30 rounded-xl px-5 py-3.5 text-green-600 text-sm font-semibold shadow-lg z-[9999] backdrop-blur-xl animate-in slide-in-from-bottom-4 fade-in">
          <CheckCircle size={18} />
          Documents uploaded & processed successfully!
        </div>
      )}
    </div>
  );
};

export default UploadPage;
