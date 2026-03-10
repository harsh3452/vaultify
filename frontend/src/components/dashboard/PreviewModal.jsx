import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  Download,
  Trash2,
  FileImage,
  FileType,
  Loader,
  RotateCcw,
  RotateCw,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Activity,
  SquarePen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";
import { useCachedPreview } from "@/components/ui/CachedImage";
import ActivityTrail from "@/components/dashboard/ActivityTrail";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const PreviewModal = ({ file, clientName, onClose, onRefresh, onReanalyze, onEdit, previewSrc, firebasePath, backendUrl, canDownload = true, canDelete = true, canReanalyze = true, isShared = false, sharedDocId }) => {
  const cachedSrc = useCachedPreview(firebasePath, backendUrl);
  const imgSrc = cachedSrc || previewSrc; // fallback to previewSrc if cache not ready
  const [format, setFormat] = useState("pdf");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTrail, setShowTrail] = useState(false);

  // ── Zoom / pan state ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef(null);
  const imgContainerRef = useRef(null);

  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  const fitZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Wheel zoom (scroll = zoom; trackpad pinch via ctrlKey)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.ctrlKey
      ? -e.deltaY * 0.01
      : -e.deltaY * 0.002;
    setZoom((z) => clampZoom(z + delta * z));
  }, []);

  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Drag-to-pan when zoomed in
  const onMouseDown = (e) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e) => {
    if (!isDragging || !dragStart.current) return;
    setPan({
      x: dragStart.current.px + (e.clientX - dragStart.current.mx),
      y: dragStart.current.py + (e.clientY - dragStart.current.my),
    });
  };
  const onMouseUp = () => { setIsDragging(false); dragStart.current = null; };

  const displayName = file?.firebase_path
    ? file.firebase_path.split("/").pop().replace(/\.webp$/i, "").replace(/_/g, " ")
    : file?.filename || "Document";

  const handleDownload = async () => {
    setIsProcessing(true);
    setProgress(0);
    const interval = setInterval(
      () => setProgress((p) => (p >= 90 ? p : p + 10)),
      700
    );
    try {
      const url = isShared
        ? `${API}/shared/download?doc_id=${encodeURIComponent(sharedDocId)}&format=${format}&rotation=${rotation}`
        : `${API}/download?path=${encodeURIComponent(file.firebase_path)}&format=${format}&rotation=${rotation}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Download Failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = window.URL.createObjectURL(blob);
      const dlName = file.firebase_path
        ? file.firebase_path.split("/").pop().replace(/\.webp$/i, "")
        : file.filename;
      a.download = `${dlName}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => setIsProcessing(false), 1000);
    } catch (e) {
      alert("Error: " + e.message);
      setIsProcessing(false);
      clearInterval(interval);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      const res = await authFetch(
        `${API}/delete?path=${encodeURIComponent(file.firebase_path)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        onClose();
        onRefresh();
      } else alert("Delete failed");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-[900px] h-[600px] flex overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview side — zoomable */}
        <div
          ref={imgContainerRef}
          className="flex-[1.5] bg-muted flex items-center justify-center border-r border-border overflow-hidden relative select-none"
          style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <img
            src={imgSrc}
            alt="Preview"
            draggable={false}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: "center center",
              maxWidth: "none",
              maxHeight: "none",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              transition: isDragging ? "none" : "transform 0.15s ease-out",
            }}
          />

          {/* Zoom controls — bottom-left */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-xl px-2 py-1.5 z-10">
            <button
              onClick={(e) => { e.stopPropagation(); setZoom((z) => clampZoom(z - ZOOM_STEP)); }}
              className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[0.65rem] text-white/70 w-10 text-center font-mono">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setZoom((z) => clampZoom(z + ZOOM_STEP)); }}
              className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <div className="w-px h-4 bg-white/20 mx-0.5" />
            <button
              onClick={(e) => { e.stopPropagation(); fitZoom(); }}
              className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
              title="Fit to view"
            >
              <Maximize2 size={13} />
            </button>
          </div>

          {/* Hint — top-left */}
          <div className="absolute top-2 left-2 text-[0.6rem] text-white/40 pointer-events-none z-10">
            Scroll to zoom · drag to pan
          </div>
        </div>

        {/* Controls side */}
        <div className="flex-1 p-6 flex flex-col gap-5">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-semibold">{displayName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary">
                  {file.type.replace(/_/g, " ")}
                </Badge>
                {file.file_size && (
                  <Badge
                    variant="outline"
                    className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800"
                  >
                    {Math.round(file.file_size / 1024)}KB
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X size={20} />
            </Button>
          </div>

          {/* Controls */}
          {canDownload && (
          <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Download Options
            </span>

            {/* Rotate */}
            <div className="flex gap-2 pb-3 border-b border-border">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setRotation((r) => r - 90)}
              >
                <RotateCcw size={14} /> Rotate Left
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setRotation((r) => r + 90)}
              >
                <RotateCw size={14} /> Rotate Right
              </Button>
            </div>

            {/* Format */}
            <div>
              <span className="text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-wider">
                Target Format
              </span>
              <div className="flex gap-2 mt-1.5">
                <Button
                  variant={format === "pdf" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setFormat("pdf")}
                >
                  <FileType size={14} /> PDF
                </Button>
                <Button
                  variant={format === "jpg" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setFormat("jpg")}
                >
                  <FileImage size={14} /> JPG
                </Button>
              </div>
            </div>
          </div>
          )}

          {/* Re-analyze */}
          {canReanalyze && onReanalyze && (
            <Button variant="outline" className="w-full" onClick={onReanalyze}>
              <RefreshCw size={14} /> Re-analyze Document
            </Button>
          )}

          {/* Edit metadata */}
          {!isShared && onEdit && (
            <Button variant="outline" className="w-full" onClick={onEdit}>
              <SquarePen size={14} /> Edit Document
            </Button>
          )}

          {/* Activity Trail */}
          {!isShared && (
            <Button variant="outline" className="w-full" onClick={() => setShowTrail(true)}>
              <Activity size={14} /> Activity Trail
            </Button>
          )}

          {/* Actions */}
          <div className="mt-auto space-y-2">
            {canDownload && (
            <Button
              className="w-full"
              onClick={handleDownload}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader size={16} className="animate-spin" /> Downloading...{" "}
                  {progress}%
                </>
              ) : (
                <>
                  <Download size={16} /> Download
                </>
              )}
            </Button>
            )}

            {canDelete && (
            <Button
              variant="outline"
              className={`w-full ${
                confirmDelete
                  ? "border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20"
                  : "text-destructive hover:bg-destructive hover:text-destructive-foreground"
              }`}
              onClick={handleDelete}
            >
              <Trash2 size={16} />{" "}
              {confirmDelete ? "Confirm Delete?" : "Delete File"}
            </Button>
            )}

            {confirmDelete && canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Activity Trail slide-out */}
      {showTrail && (
        <ActivityTrail
          docId={file?.doc_id}
          docName={displayName}
          onClose={() => setShowTrail(false)}
        />
      )}
    </div>
  );
};

export default PreviewModal;
