import React, { useState } from "react";
import {
  FileImage,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";
import { useUpload } from "@/contexts/UploadContext";

const formatBytes = (bytes) => {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const StatusIcon = ({ status }) => {
  if (status === "pending")
    return <Clock size={14} className="text-muted-foreground shrink-0" />;
  if (status === "uploading")
    return <Loader2 size={14} className="animate-spin text-primary shrink-0" />;
  if (status === "done")
    return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
  if (status === "duplicate")
    return <AlertCircle size={14} className="text-amber-500 shrink-0" />;
  if (status === "error")
    return <AlertCircle size={14} className="text-destructive shrink-0" />;
  return null;
};

const UploadTray = () => {
  const { queue, clearCompleted, dismissAll, allFinished } = useUpload();
  const [collapsed, setCollapsed] = useState(false);

  if (queue.length === 0) return null;

  /* ── Header summary text ── */
  const doneCount  = queue.filter((q) => ["done", "duplicate", "error"].includes(q.status)).length;
  const totalCount = queue.length;
  const dupCount   = queue.filter((q) => q.status === "duplicate").length;
  const errCount   = queue.filter((q) => q.status === "error").length;
  const okCount    = queue.filter((q) => q.status === "done").length;

  let headerText;
  if (!allFinished) {
    headerText = `Uploading ${doneCount + 1} of ${totalCount}…`;
  } else {
    const parts = [];
    if (okCount > 0)  parts.push(`${okCount} uploaded`);
    if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount > 1 ? "s" : ""}`);
    if (errCount > 0) parts.push(`${errCount} failed`);
    headerText = parts.join(" · ") || "Done";
  }

  return (
    <div
      className="fixed bottom-24 right-6 z-[900] w-72 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
      style={{ maxHeight: collapsed ? "auto" : "360px" }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/60 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {allFinished
            ? <CheckCircle2 size={13} className="text-green-500 shrink-0" />
            : <Loader2 size={13} className="animate-spin text-primary shrink-0" />
          }
          <span className="text-xs font-semibold truncate">{headerText}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          {allFinished && (
            <button
              onClick={dismissAll}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* ── File list ── */}
      {!collapsed && (
        <>
          <div className="overflow-y-auto max-h-52">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2.5 px-4 py-2 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                {/* Thumbnail */}
                {item.preview ? (
                  <img
                    src={item.preview}
                    alt=""
                    className={`w-8 h-8 rounded-lg object-cover shrink-0 border border-border transition-opacity ${
                      item.status === "pending" ? "opacity-40" : "opacity-100"
                    }`}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                    <FileImage size={14} className="text-muted-foreground" />
                  </div>
                )}

                {/* Name + size */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-tight">
                    {item.file.name}
                  </p>
                  {item.status === "duplicate" ? (
                    <p className="text-[0.6rem] text-amber-500 leading-tight">Already in vault</p>
                  ) : item.status === "error" ? (
                    <p className="text-[0.6rem] text-destructive leading-tight truncate">
                      {item.errorMsg || "Failed"}
                    </p>
                  ) : item.status === "done" && item.needsReview ? (
                    <p className="text-[0.6rem] text-amber-500 leading-tight">Needs review</p>
                  ) : (
                    <p className="text-[0.6rem] text-muted-foreground leading-tight">
                      {formatBytes(item.file.size)}
                    </p>
                  )}
                </div>

                {/* Status icon */}
                <StatusIcon status={item.status} />
              </div>
            ))}
          </div>

          {/* ── Footer ── */}
          {allFinished && (
            <div className="px-4 py-2 border-t border-border flex justify-between items-center">
              <button
                onClick={clearCompleted}
                className="text-[0.7rem] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear finished
              </button>
              <button
                onClick={dismissAll}
                className="text-[0.7rem] text-muted-foreground hover:text-foreground transition-colors"
              >
                Dismiss all
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UploadTray;
