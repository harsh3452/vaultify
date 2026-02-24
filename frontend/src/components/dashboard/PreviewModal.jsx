import React, { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";

const PreviewModal = ({ file, clientName, onClose, onRefresh, onReanalyze, previewSrc }) => {
  const [format, setFormat] = useState("pdf");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      const res = await authFetch(
        `${API}/download?path=${encodeURIComponent(file.firebase_path)}&format=${format}&rotation=${rotation}`
      );
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
        {/* Preview side */}
        <div className="flex-[1.5] bg-muted flex items-center justify-center p-5 border-r border-border">
          <img
            src={previewSrc}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-md"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: "transform 0.3s ease",
            }}
          />
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

          {/* Re-analyze */}
          {onReanalyze && (
            <Button variant="outline" className="w-full" onClick={onReanalyze}>
              <RefreshCw size={14} /> Re-analyze Document
            </Button>
          )}

          {/* Actions */}
          <div className="mt-auto space-y-2">
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

            {confirmDelete && (
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
    </div>
  );
};

export default PreviewModal;
