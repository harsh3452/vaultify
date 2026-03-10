import React, { useState, useEffect } from "react";
import {
  X,
  Upload,
  Download,
  Eye,
  Trash2,
  Undo2,
  Star,
  StarOff,
  Share2,
  Activity,
  Monitor,
  Loader,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authFetch, API } from "@/lib/api";

const ACTION_META = {
  upload:   { icon: Upload,   color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Uploaded" },
  preview:  { icon: Eye,      color: "text-blue-500",    bg: "bg-blue-500/10",    label: "Previewed" },
  download: { icon: Download, color: "text-violet-500",  bg: "bg-violet-500/10",  label: "Downloaded" },
  delete:   { icon: Trash2,   color: "text-red-500",     bg: "bg-red-500/10",     label: "Deleted" },
  trash:    { icon: Trash2,   color: "text-orange-500",  bg: "bg-orange-500/10",  label: "Trashed" },
  restore:  { icon: Undo2,    color: "text-teal-500",    bg: "bg-teal-500/10",    label: "Restored" },
  star:     { icon: Star,     color: "text-amber-500",   bg: "bg-amber-500/10",   label: "Starred" },
  unstar:   { icon: StarOff,  color: "text-gray-400",    bg: "bg-gray-500/10",    label: "Unstarred" },
  share:    { icon: Share2,   color: "text-indigo-500",  bg: "bg-indigo-500/10",  label: "Shared" },
};

const formatDateTime = (isoStr) => {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diff = (now - d) / 1000;

    // Relative part
    let relative;
    if (diff < 60) relative = "just now";
    else if (diff < 3600) relative = `${Math.floor(diff / 60)}m ago`;
    else if (diff < 86400) relative = `${Math.floor(diff / 3600)}h ago`;
    else if (diff < 172800) relative = "yesterday";
    else relative = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // Absolute part
    const absolute = d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });

    return { relative, absolute };
  } catch {
    return { relative: isoStr, absolute: isoStr };
  }
};

const ActivityTrail = ({ docId, docName, onClose }) => {
  const [trail, setTrail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!docId) return;
    const fetchTrail = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`${API}/activity/trail?doc_id=${encodeURIComponent(docId)}`);
        if (res.ok) {
          const data = await res.json();
          setTrail(data.trail || []);
          setTotal(data.total || 0);
        }
      } catch {}
      setLoading(false);
    };
    fetchTrail();
  }, [docId]);

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-end bg-black/20 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-[420px] h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border shrink-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Activity size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">Activity Trail</h3>
            <p className="text-xs text-muted-foreground truncate">{docName}</p>
          </div>
          <Badge variant="secondary" className="text-[0.6rem] shrink-0">
            {total} event{total !== 1 ? "s" : ""}
          </Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Trail content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader size={24} className="animate-spin" />
              <p className="text-sm">Loading audit trail...</p>
            </div>
          ) : !trail.length ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Activity size={36} className="opacity-30" />
              <p className="text-sm">No activity recorded for this document.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />

              <div className="space-y-0">
                {trail.map((entry, i) => {
                  const meta = ACTION_META[entry.action] || ACTION_META.preview;
                  const Icon = meta.icon;
                  const { relative, absolute } = formatDateTime(entry.accessed_at);

                  return (
                    <div key={i} className="flex gap-3 py-2.5 relative">
                      {/* Timeline dot */}
                      <div className={`w-[30px] h-[30px] rounded-full ${meta.bg} flex items-center justify-center shrink-0 z-10 border-2 border-card`}>
                        <Icon size={12} className={meta.color} />
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[0.6rem] ${meta.color} border-current/20`}
                          >
                            {meta.label}
                          </Badge>
                          <span className="text-[0.6rem] text-muted-foreground">{relative}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{absolute}</p>
                        {/* IP / device info if available */}
                        {entry.ip && (
                          <div className="flex items-center gap-1 mt-1 text-[0.6rem] text-muted-foreground/60">
                            <Monitor size={8} />
                            <span>{entry.ip}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityTrail;
