import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { authFetch, API } from "@/lib/api";

const UploadContext = createContext(null);

export const useUpload = () => useContext(UploadContext);

const isImage = (f) => f.type.startsWith("image/");

export const UploadProvider = ({ children, onFileSuccess }) => {
  const [queue, setQueue] = useState([]);
  const processingRef    = useRef(false);
  // Keep onFileSuccess stable across renders via ref
  const onFileSuccessRef = useRef(onFileSuccess);
  useEffect(() => { onFileSuccessRef.current = onFileSuccess; }, [onFileSuccess]);

  /* ── Warn before refresh/close if uploads are in progress ── */
  useEffect(() => {
    const active = queue.some((q) => q.status === "pending" || q.status === "uploading");
    if (!active) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [queue]);

  /* ── Add files to queue (deduplicates by name+size) ── */
  const addFiles = useCallback((files) => {
    const incoming = Array.from(files).filter(
      (f) => isImage(f) || f.type === "application/pdf"
    );
    setQueue((prev) => {
      const keys = new Set(prev.map((q) => q.file.name + q.file.size));
      const next = incoming
        .filter((f) => !keys.has(f.name + f.size))
        .map((f) => ({
          id:       `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file:     f,
          preview:  isImage(f) ? URL.createObjectURL(f) : null,
          status:   "pending",   // pending | uploading | done | duplicate | error
          errorMsg: null,
        }));
      return [...prev, ...next];
    });
  }, []);

  /* ── Remove finished items; keep pending/uploading ── */
  const clearCompleted = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((q) => {
        if (q.preview && q.status !== "pending" && q.status !== "uploading") {
          URL.revokeObjectURL(q.preview);
        }
      });
      return prev.filter(
        (q) => q.status === "pending" || q.status === "uploading"
      );
    });
  }, []);

  /* ── Dismiss entire tray ── */
  const dismissAll = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((q) => q.preview && URL.revokeObjectURL(q.preview));
      return [];
    });
  }, []);

  /* ── Sequential processor — picks next pending and uploads it ── */
  useEffect(() => {
    if (processingRef.current) return;

    const next = queue.find((q) => q.status === "pending");
    if (!next) return;

    processingRef.current = true;

    // Mark it as "uploading" immediately
    setQueue((prev) =>
      prev.map((q) => (q.id === next.id ? { ...q, status: "uploading" } : q))
    );

    const run = async () => {
      try {
        const fd = new FormData();
        fd.append("files", next.file);

        const res  = await authFetch(`${API}/upload`, { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));

        const processed = data.processed || [];
        const failed    = data.failed    || [];

        let newStatus  = "done";
        let errorMsg   = null;
        let needsReview = false;

        if (processed.length === 0 && failed.length > 0) {
          const err = failed[0]?.error || "Unknown error";
          newStatus = err === "Already exists" ? "duplicate" : "error";
          errorMsg  = err;
        } else if (processed.length > 0) {
          needsReview = !!processed[0]?.needs_review;
        }

        setQueue((prev) =>
          prev.map((q) =>
            q.id === next.id ? { ...q, status: newStatus, errorMsg, needsReview } : q
          )
        );

        if (newStatus === "done") {
          onFileSuccessRef.current?.();
        }
      } catch {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === next.id
              ? { ...q, status: "error", errorMsg: "Network error" }
              : q
          )
        );
      } finally {
        processingRef.current = false;
      }
    };

    run();
  }, [queue]);

  /* ── Derived counts ── */
  const pendingCount   = queue.filter((q) => q.status === "pending").length;
  const uploadingCount = queue.filter((q) => q.status === "uploading").length;
  const doneCount      = queue.filter((q) => q.status === "done").length;
  const isActive       = queue.length > 0;
  const allFinished    = isActive && pendingCount === 0 && uploadingCount === 0;

  return (
    <UploadContext.Provider
      value={{
        queue,
        addFiles,
        clearCompleted,
        dismissAll,
        pendingCount,
        uploadingCount,
        doneCount,
        isActive,
        allFinished,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
};
