import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Share2,
  Mail,
  Trash2,
  ChevronDown,
  Eye,
  Download,
  Loader,
  Link2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";

/**
 * ShareDialog — lets the vault owner share a document or client folder.
 *
 * Props:
 *   resourceType  – "document" | "client"
 *   resourceId    – doc_id or client name
 *   resourceLabel – human-readable label (e.g. filename or client name)
 *   onClose       – close callback
 */
const ShareDialog = ({ resourceType, resourceId, resourceLabel, onClose }) => {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("viewer");
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchShares = useCallback(async () => {
    try {
      const res = await authFetch(
        `${API}/auth/shares/for-resource?resource_type=${resourceType}&resource_id=${encodeURIComponent(resourceId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares || []);
      }
    } catch {}
    setLoading(false);
  }, [resourceType, resourceId]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const handleShare = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError("");
    setSuccess("");

    try {
      const res = await authFetch(`${API}/auth/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          resource_type: resourceType,
          resource_id: resourceId,
          permission,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`Shared with ${email.trim()}`);
        setEmail("");
        fetchShares();
      } else {
        setError(data.error || "Failed to share");
      }
    } catch {
      setError("Network error");
    }
    setSending(false);
  };

  const handleRevoke = async (shareId) => {
    try {
      const res = await authFetch(`${API}/auth/share/${shareId}`, {
        method: "DELETE",
      });
      if (res.ok) fetchShares();
    } catch {}
  };

  const handlePermissionChange = async (shareId, newPerm) => {
    try {
      await authFetch(`${API}/auth/share/${shareId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: newPerm }),
      });
      fetchShares();
    } catch {}
  };

  const kind = resourceType === "client" ? "Folder" : "Document";

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Share2 size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Share {kind}</h3>
              <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                {(resourceLabel || resourceId).replace(/_/g, " ")}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Add people form */}
        <form onSubmit={handleShare} className="px-5 py-4 border-b border-border">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="email"
                placeholder="Add people by email..."
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); setSuccess(""); }}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-muted/50 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            {/* Permission dropdown */}
            <div className="relative">
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                className="h-9 pl-3 pr-7 rounded-lg border border-border bg-muted/50 text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>

            <Button type="submit" size="sm" className="h-9 px-4" disabled={sending || !email.trim()}>
              {sending ? <Loader size={14} className="animate-spin" /> : <UserPlus size={14} />}
            </Button>
          </div>

          {/* Permission hint */}
          <p className="text-[0.65rem] text-muted-foreground mt-2">
            <strong>Viewer</strong> = preview only &nbsp;·&nbsp; <strong>Editor</strong> = preview + download
          </p>

          {error && (
            <p className="text-xs text-destructive mt-2">{error}</p>
          )}
          {success && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">{success}</p>
          )}
        </form>

        {/* People with access */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            People with access
          </span>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Link2 size={24} className="opacity-30" />
              <p className="text-xs">Not shared with anyone yet.</p>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {shares.map((s) => (
                <div
                  key={s.share_id}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                    {s.shared_with_email.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.shared_with_email}
                    </p>
                    <p className="text-[0.65rem] text-muted-foreground">
                      Shared {s.created_at}
                    </p>
                  </div>

                  {/* Permission toggle */}
                  <div className="relative">
                    <select
                      value={s.permission}
                      onChange={(e) => handlePermissionChange(s.share_id, e.target.value)}
                      className="h-7 pl-2 pr-6 rounded-md border border-border bg-card text-xs appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <ChevronDown
                      size={10}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => handleRevoke(s.share_id)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove access"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
