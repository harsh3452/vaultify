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
  RefreshCw,
} from "lucide-react";
import { useUpload } from "@/contexts/UploadContext";

const formatBytes = (bytes) => {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const StatusIcon = ({ status, kind }) => {
  if (status === "pending")
    return <Clock size={14} className="text-muted-foreground shrink-0" />;
  if (status === "uploading")
    return kind === "reanalyze"
      ? <RefreshCw size={14} className="animate-spin text-primary shrink-0" />
      : <Loader2  size={14} className="animate-spin text-primary shrink-0" />;
  if (status === "done")
    return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
  if (status === "duplicate")
    return <AlertCircle size={14} className="text-amber-500 shrink-0" />;
  if (status === "error")
    return <AlertCircle size={14} className="text-destructive shrink-0" />;
  return null;
};

const ItemSubtitle = ({ item }) => {
  if (item.status === "duplicate")
    return <p className="text-[0.6rem] text-amber-500 leading-tight">Already in vault</p>;
  if (item.status === "error")
    return <p className="text-[0.6rem] text-destructive leading-tight truncate">{item.errorMsg || "Failed"}</p>;
  if (item.status === "done" && item.reassigned)
    return <p className="text-[0.6rem] text-blue-500 leading-tight truncate">Moved → {item.newClient?.replace(/_/g, " ") || "new folder"}</p>;
  if (item.status === "done" && item.needsReview)
    return <p className="text-[0.6rem] text-amber-500 leading-tight">Needs review</p>;
  if (item.status === "done")
    return <p className="text-[0.6rem] text-green-600 leading-tight">{item.kind === "reanalyze" ? "Reanalyzed" : "Uploaded"}</p>;
  if (item.status === "uploading")
    return <p className="text-[0.6rem] text-muted-foreground leading-tight">{item.kind === "reanalyze" ? "Analyzing…" : "Uploading…"}</p>;
  if (item.kind === "upload" && item.file?.size)
    return <p className="text-[0.6rem] text-muted-foreground leading-tight">{formatBytes(item.file.size)}</p>;
  return <p className="text-[0.6rem] text-muted-foreground leading-tight">Queued</p>;
};

const Thumb = ({ item }) => {
  const dim = "w-8 h-8 rounded-lg shrink-0 border border-border overflow-hidden";
  if (item.preview)
    return (
      <img
        src={item.preview}
        alt=""
        className={`${dim} object-cover ${item.status === "pending" ? "opacity-40" : "opacity-100"} transition-opacity`}
      />
    );
  return (
    <div className={`${dim} bg-muted flex items-center justify-center`}>
      {item.kind === "reanalyze"
        ? <RefreshCw size={13} className="text-muted-foreground" />
        : <FileImage size={13} className="text-muted-foreground" />
      }
    </div>
  );
};

const TrayRow = ({ item }) => (
  <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
    <Thumb item={item} />
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium truncate leading-tight">{item.label}</p>
      <ItemSubtitle item={item} />
    </div>
    <StatusIcon status={item.status} kind={item.kind} />
  </div>
);

const SectionLabel = ({ label }) => (
  <div className="px-4 py-1 bg-muted/40 border-b border-border">
    <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
  </div>
);

const UploadTray = () => {
  const { queue, clearCompleted, dismissAll, allFinished } = useUpload();
  const [collapsed, setCollapsed] = useState(false);

  if (queue.length === 0) return null;

  const uploads    = queue.filter((q) => q.kind === "upload");
  const reanalyzes = queue.filter((q) => q.kind === "reanalyze");
  const totalCount = queue.length;
  const doneCount  = queue.filter((q) => ["done", "duplicate", "error"].includes(q.status)).length;
  const dupCount   = queue.filter((q) => q.status === "duplicate").length;
  const errCount   = queue.filter((q) => q.status === "error").length;
  const okCount    = queue.filter((q) => q.status === "done").length;
  const showSections = uploads.length > 0 && reanalyzes.length > 0;

  let headerText;
  if (!allFinished) {
    const inFlight = queue.find((q) => q.status === "uploading");
    const verb     = inFlight?.kind === "reanalyze" ? "Analyzing" : "Uploading";
    headerText = `${verb} ${doneCount + 1} of ${totalCount}…`;
  } else {
    const parts = [];
    if (okCount  > 0) parts.push(`${okCount} done`);
    if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount > 1 ? "s" : ""}`);
    if (errCount > 0) parts.push(`${errCount} failed`);
    headerText = parts.join(" · ") || "Done";
  }

  return (
    <div className="fixed bottom-24 right-6 z-[900] w-72 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
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
            <button onClick={dismissAll} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Dismiss">
              <X size={13} />
            </button>
          )}
          <button onClick={() => setCollapsed((c) => !c)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* ── List ── */}
      {!collapsed && (
        <>
          <div className="overflow-y-auto max-h-64">
            {showSections ? (
              <>
                <SectionLabel label="Uploads" />
                {uploads.map((item) => <TrayRow key={item.id} item={item} />)}
                <SectionLabel label="Re-analyze" />
                {reanalyzes.map((item) => <TrayRow key={item.id} item={item} />)}
              </>
            ) : (
              queue.map((item) => <TrayRow key={item.id} item={item} />)
            )}
          </div>

          {allFinished && (
            <div className="px-4 py-2 border-t border-border flex justify-between items-center">
              <button onClick={clearCompleted} className="text-[0.7rem] text-muted-foreground hover:text-foreground transition-colors">Clear finished</button>
              <button onClick={dismissAll} className="text-[0.7rem] text-muted-foreground hover:text-foreground transition-colors">Dismiss all</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UploadTray;
