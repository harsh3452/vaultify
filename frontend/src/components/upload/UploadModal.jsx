import React, { useState, useRef, useCallback } from "react";
import {
  ImageIcon,
  FolderOpen,
  Upload,
  X,
  FileImage,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpload } from "@/contexts/UploadContext";

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};
const isImage = (f) => f.type.startsWith("image/");

/* ── Picker content inside the dialog ── */
const PickerContent = ({ onClose }) => {
  const { addFiles } = useUpload();
  const [staged, setStaged] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const imagesRef = useRef(null);
  const folderRef = useRef(null);

  const stageFiles = useCallback((files) => {
    const incoming = Array.from(files).filter(
      (f) => isImage(f) || f.type === "application/pdf"
    );
    setStaged((prev) => {
      const keys = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...incoming.filter((f) => !keys.has(f.name + f.size))];
    });
  }, []);

  const removeStaged = (idx) =>
    setStaged((prev) => prev.filter((_, i) => i !== idx));

  const handleStart = () => {
    if (!staged.length) return;
    addFiles(staged);  // hand off to context — uploads begin in background
    onClose();         // close dialog immediately, tray takes over
  };

  const dropHandlers = {
    onDragOver:  (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: ()  => setDragOver(false),
    onDrop:      (e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files); },
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
        onClick={() => imagesRef.current?.click()}
        {...dropHandlers}
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <ImageIcon size={26} />
        </div>
        <p className="text-sm font-semibold">Drop files here or click to browse</p>
        <p className="text-xs text-muted-foreground">JPG, PNG, WEBP, PDF — or pick an entire folder</p>
        <div className="flex gap-2 mt-1">
          <button
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors"
            onClick={(e) => { e.stopPropagation(); imagesRef.current?.click(); }}
          >
            <ImageIcon size={11} /> Files
          </button>
          <button
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors"
            onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
          >
            <FolderOpen size={11} /> Folder
          </button>
        </div>

        <input ref={imagesRef} type="file" multiple accept="image/*,.pdf" className="hidden"
          onChange={(e) => { stageFiles(e.target.files); e.target.value = ""; }} />
        <input ref={folderRef} type="file" webkitdirectory="" mozdirectory="" directory="" multiple className="hidden"
          onChange={(e) => { stageFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {/* Staged list */}
      {staged.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50">
            <span className="text-xs font-semibold">
              {staged.length} file{staged.length > 1 ? "s" : ""} ready
            </span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setStaged([])}
            >
              Clear
            </button>
          </div>
          <ScrollArea className="max-h-[180px]">
            {staged.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 px-4 py-2 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
              >
                {isImage(file) ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="w-9 h-9 rounded-lg object-cover bg-primary/10 border border-border shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-primary/10 border border-border flex items-center justify-center text-primary shrink-0">
                    <FileImage size={16} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{file.name}</p>
                  <p className="text-[0.65rem] text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                <button
                  onClick={() => removeStaged(idx)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}

      {/* Start button */}
      <Button onClick={handleStart} disabled={staged.length === 0} className="w-full">
        <Upload size={16} />
        Upload{staged.length > 0 ? ` (${staged.length})` : ""}
      </Button>
    </div>
  );
};

/* ── FAB + Dialog ── */
const UploadModal = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating action button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 h-14 px-5 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 transition-all"
      >
        <Plus size={22} strokeWidth={2.5} />
        <span className="font-semibold text-sm hidden sm:inline">New</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Documents</DialogTitle>
          </DialogHeader>
          <PickerContent onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UploadModal;
