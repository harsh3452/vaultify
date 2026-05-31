import React, { useState, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { auth } from "@/lib/firebase";
import { authFetch, API } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import VerifyEmailPage from "@/components/auth/VerifyEmailPage";
import ForgotPasswordPage from "@/components/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/components/auth/ResetPasswordPage";
import VerifyActionPage from "@/components/auth/VerifyActionPage";
import DashboardShell from "@/components/dashboard/DashboardShell";
import PreviewModal from "@/components/dashboard/PreviewModal";
import EditDocModal from "@/components/dashboard/EditDocModal";
import UploadModal from "@/components/upload/UploadModal";
import UploadTray from "@/components/upload/UploadTray";
import ShareDialog from "@/components/dashboard/ShareDialog";
import SharedWithMe from "@/components/dashboard/SharedWithMe";
import { UploadProvider, useUpload } from "@/contexts/UploadContext";

import {
  Folder,
  Search,
  ChevronRight,
  HardDrive,
  Users,
  FileText,
  HardDrive as StorageIcon,
  AlertTriangle,
  Clock,
  Star,
  StarOff,
  Trash2,
  Undo2,
  AlertCircle,
  FileImage,
  CheckCircle,
  RefreshCw,
  LayoutGrid,
  List,
  SquarePen,
  CheckSquare,
  Square,
  X,
  ShieldAlert,
  Share2,
  Upload,
  Download,
  Eye,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CachedImage, { useCachedPreview } from "@/components/ui/CachedImage";
import { invalidatePreview, clearPreviewCache } from "@/lib/imageCache";

// ─── FIREBASE ACTION HANDLER (email links) ───────────────────────
const FirebaseActionRouter = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode");

  if (mode === "verifyEmail") return <VerifyActionPage />;
  if (mode === "resetPassword") return <ResetPasswordRoute />;

  return <Navigate to="/login" replace />;
};

// ─── RESET PASSWORD (route wrapper) ──────────────────────────────
const ResetPasswordRoute = () => {
  const navigate = useNavigate();
  return (
    <ResetPasswordPage
      onBackToLogin={() => navigate("/login", { replace: true })}
      onAutoLogin={() => navigate("/dashboard", { replace: true })}
    />
  );
};

// ─── PROTECTED DASHBOARD ROUTE (inner – runs inside UploadProvider) ────────────
const DashboardContent = ({ firebaseUser, setFirebaseUser, refreshRef }) => {
  const navigate = useNavigate();
  const { connectGoogleDrive } = useAuth();
  const [viewState, setViewState] = useState("home");
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashStats, setDashStats] = useState({
    storage_used_mb: 0,
    needs_review: 0,
    pending_count: 0,
  });
  const [authToken, setAuthToken] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [reviewClients, setReviewClients] = useState([]);
  const [layoutMode, setLayoutMode] = useState("grid");
  // Bulk selection
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  // Edit / type-override modal
  const [editDoc, setEditDoc] = useState(null);
  // Starred & Trash
  const [starredDocs, setStarredDocs] = useState([]);
  const [trashedDocs, setTrashedDocs] = useState([]);
  const [activityFilter, setActivityFilter] = useState("all");
  const [retrying, setRetrying] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [storageMode, setStorageMode] = useState("firebase");
  const [hasGdrive, setHasGdrive] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);

  // ── Sharing ──
  const [shareTarget, setShareTarget] = useState(null); // { resourceType, resourceId, resourceLabel }
  const [sharedPreviewDoc, setSharedPreviewDoc] = useState(null); // { doc, share }

  // Fetch user info once on mount
  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await authFetch(`${API}/auth/me`);
        if (!res.ok) return;
        const data = await res.json();
        setStorageMode(data.storage_mode || "firebase");
        setHasGdrive(Boolean(data.has_gdrive));
      } catch {}
    };
    if (firebaseUser) fetchMe();
  }, [firebaseUser]);

  // Cache token for <img src> preview URLs
  useEffect(() => {
    if (!firebaseUser) return;
    const getAndSetToken = async () => {
      try {
        setAuthToken(await firebaseUser.getIdToken(true));
      } catch {}
    };
    getAndSetToken();
    const interval = setInterval(getAndSetToken, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [firebaseUser]);

  const updateStorageMode = async (mode) => {
    setSettingsError("");
    setSettingsBusy(true);
    try {
      const res = await authFetch(`${API}/auth/storage-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_mode: mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSettingsError(data.error || "Failed to update storage mode");
        return;
      }
      setStorageMode(mode);
    } catch (e) {
      setSettingsError("Failed to update storage mode");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleConnectDrive = async () => {
    setSettingsError("");
    setSettingsBusy(true);
    try {
      await connectGoogleDrive();
      setHasGdrive(true);
      setStorageMode("gdrive");
    } catch (e) {
      setSettingsError("Google Drive connect failed. Please try again.");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleWipe = async () => {
    setWiping(true);
    try {
      const res = await authFetch(`${API}/wipe`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        alert(`Wipe complete: ${data.storage_files_deleted} storage files deleted, ${data.activity_entries_removed} activity entries removed.`);
        setShowWipeConfirm(false);
        refreshAll();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Wipe failed");
      }
    } catch (e) {
      alert("Wipe request failed: " + e.message);
    } finally {
      setWiping(false);
    }
  };

  const previewKey = (file) =>
    file?.firebase_path || (file?.doc_id ? `gdrive:${file.doc_id}` : "");

  const previewUrl = (fileOrPath) => {
    if (!fileOrPath) return "";
    if (typeof fileOrPath === "string") {
      return `${API}/preview?path=${encodeURIComponent(fileOrPath)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;
    }
    const firebasePath = fileOrPath.firebase_path;
    const docId = fileOrPath.doc_id;
    const query = firebasePath
      ? `path=${encodeURIComponent(firebasePath)}`
      : `doc_id=${encodeURIComponent(docId)}`;
    return `${API}/preview?${query}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;
  };

  // Primary display name: document type (most meaningful), falls back to original filename
  const docDisplayName = (file) => {
    if (file?.type && file.type !== "Unsorted") {
      return file.type.replace(/_/g, " ");
    }
    if (file?.filename) return file.filename;
    if (!file?.firebase_path) return "Document";
    return file.firebase_path.split("/").pop().replace(/\.webp(\.enc)?$/i, "").replace(/_/g, " ");
  };

  // Original filename shown as subtitle beneath the type label
  const docSubtitle = (file) => file?.filename || "";

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API}/clients`);
      if (!res.ok) {
        setDocuments([]);
        return;
      }
      const data = await res.json();
      setDocuments(
        (data.clients || []).map((c) => ({ ...c, client: c.name }))
      );
    } catch (e) {
      console.error("[Vaultify] fetchDocuments error:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchDashboard = async () => {
    try {
      const res = await authFetch(`${API}/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setDashStats({
          storage_used_mb: data.storage_used_mb,
          needs_review: data.needs_review,
          total_files: data.total_files,
          total_clients: data.total_clients,
          pending_count: data.pending_count || 0,
          by_type: data.by_type || {},
        });
      }
    } catch {}
  };

  const fetchRecent = async (filter) => {
    try {
      const f = filter || activityFilter;
      const url = f && f !== "all"
        ? `${API}/activity/recent?limit=50&action=${f}`
        : `${API}/activity/recent?limit=50`;
      const res = await authFetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecentActivity(data.recent || []);
      }
    } catch {}
  };

  const fetchReview = async () => {
    try {
      const res = await authFetch(`${API}/review`);
      if (res.ok) {
        const data = await res.json();
        setReviewClients(data.clients || []);
      }
    } catch {}
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await authFetch(
        `${API}/search?q=${encodeURIComponent(q)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        setViewState("search");
      }
    } catch {}
  };

  useEffect(() => {
    fetchDocuments();
    fetchDashboard();
  }, []);

  // Keep selectedClient in sync after refreshes (e.g. after reanalyze moves a doc)
  useEffect(() => {
    if (!selectedClient) return;
    const updated = documents.find((d) => d.client === selectedClient.client);
    if (updated) {
      setSelectedClient(updated);
    } else if (documents.length > 0) {
      // Client may have been emptied / removed — go home
      setSelectedClient(null);
      setViewState("home");
    }
  }, [documents]);

  // Fetch data when switching views
  useEffect(() => {
    if (viewState === "recent") fetchRecent();
    if (viewState === "review") fetchReview();
    if (viewState === "starred") fetchStarred();
    if (viewState === "trash") fetchTrash();
    // Clear bulk selection whenever view changes
    setSelectedDocIds(new Set());
    setBulkMode(false);
  }, [viewState]);

  const totalDocs = dashStats.total_files ?? documents.reduce((acc, d) => acc + d.documents.length, 0);
  const totalClients = dashStats.total_clients ?? documents.length;

  const openClientFolder = (client) => {
    setSelectedClient(client);
    setViewState("client-view");
  };
  const goHome = () => {
    setViewState("home");
    setSelectedClient(null);
    setSearchResults(null);
    setSearchQuery("");
  };

  const refreshAll = () => {
    fetchDocuments();
    fetchDashboard();
    fetchReview();
  };
  // Keep the ref in sync so UploadProvider's onFileSuccess always calls the latest version
  if (refreshRef) refreshRef.current = refreshAll;

  const { addReanalyze } = useUpload();

  // Queue a single doc for reanalyze in the tray
  const handleReanalyze = (docId, label, preview) => {
    addReanalyze([{ docId, label: label || "Document", preview: preview || null }]);
  };

  const fetchStarred = async () => {
    try {
      const res = await authFetch(`${API}/documents/starred`);
      if (res.ok) {
        const data = await res.json();
        setStarredDocs(data.results || []);
      }
    } catch {}
  };

  const fetchTrash = async () => {
    try {
      const res = await authFetch(`${API}/documents/trash`);
      if (res.ok) {
        const data = await res.json();
        setTrashedDocs(data.results || []);
      }
    } catch {}
  };

  const handleStar = async (docId) => {
    try {
      await authFetch(`${API}/documents/star`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId }),
      });
      refreshAll();
      if (viewState === "starred") fetchStarred();
    } catch {}
  };

  const handleTrash = async (docId) => {
    try {
      await authFetch(`${API}/documents/trash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId }),
      });
      refreshAll();
      if (viewState === "trash") fetchTrash();
    } catch {}
  };

  const handleRestore = async (docId) => {
    try {
      await authFetch(`${API}/documents/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId }),
      });
      fetchTrash();
      refreshAll();
    } catch {}
  };

  const handlePurge = async (docId) => {
    try {
      await authFetch(`${API}/documents/trash/purge?doc_id=${encodeURIComponent(docId)}`, {
        method: "DELETE",
      });
      fetchTrash();
      refreshAll();
    } catch {}
  };

  const handleBulkAction = async (action) => {
    const ids = [...selectedDocIds];
    if (!ids.length) return;
    try {
      await authFetch(`${API}/documents/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, doc_ids: ids }),
      });
      setSelectedDocIds(new Set());
      setBulkMode(false);
      refreshAll();
    } catch {}
  };

  const toggleDocSelect = (docId) => {
    setSelectedDocIds((prev) => {
      const n = new Set(prev);
      n.has(docId) ? n.delete(docId) : n.add(docId);
      return n;
    });
  };

  // ── Stat cards ───────
  const stats = [
    { icon: Users, value: totalClients, label: "Total Clients" },
    { icon: FileText, value: totalDocs, label: "Total Documents" },
    {
      icon: StorageIcon,
      value: `${dashStats.storage_used_mb} MB`,
      label: "Storage Used",
    },
    { icon: AlertTriangle, value: dashStats.needs_review, label: "Needs Review" },
    { icon: Clock, value: dashStats.pending_count, label: "Pending AI", pending: true },
  ];

  // ── Document type visualization data ───────
  const TYPE_COLORS = {
    PAN_Card:        { color: "#6366f1", bg: "bg-indigo-500" },
    Aadhar_Card:     { color: "#f59e0b", bg: "bg-amber-500" },
    Voter_ID:        { color: "#10b981", bg: "bg-emerald-500" },
    Driving_License: { color: "#3b82f6", bg: "bg-blue-500" },
    Passport:        { color: "#ec4899", bg: "bg-pink-500" },
    Unknown_Document:{ color: "#94a3b8", bg: "bg-slate-400" },
  };
  const FALLBACK_COLORS = [
    { color: "#8b5cf6", bg: "bg-violet-500" },
    { color: "#14b8a6", bg: "bg-teal-500" },
    { color: "#f97316", bg: "bg-orange-500" },
    { color: "#ef4444", bg: "bg-red-500" },
    { color: "#06b6d4", bg: "bg-cyan-500" },
  ];

  const getTypeEntries = () => {
    const byType = dashStats.by_type || {};
    const entries = Object.entries(byType).sort(([,a], [,b]) => b - a);
    let fallbackIdx = 0;
    return entries.map(([type, count]) => {
      const preset = TYPE_COLORS[type];
      const colors = preset || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length];
      return { type, count, ...colors };
    });
  };

  const renderDashboard = () => {
    const typeEntries = getTypeEntries();
    const typeTotal = typeEntries.reduce((s, t) => s + t.count, 0) || 1;

    // Build conic-gradient stops for donut
    let conicStops = [];
    let cumPct = 0;
    typeEntries.forEach((t) => {
      const pct = (t.count / typeTotal) * 100;
      conicStops.push(`${t.color} ${cumPct}% ${cumPct + pct}%`);
      cumPct += pct;
    });
    if (!conicStops.length) conicStops.push("hsl(var(--muted)) 0% 100%");
    const conicGradient = `conic-gradient(${conicStops.join(", ")})`;

    return (
      <div className="space-y-6 mb-6">
        {/* Row 1: Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(({ icon: Icon, value, label, pending }, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-3 p-4 rounded-2xl border bg-card ${
                pending && value > 0 ? "border-amber-500/40" : "border-border"
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                pending && value > 0 ? "bg-amber-500/10 text-amber-500" : "bg-muted text-foreground"
              }`}>
                <Icon size={20} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold leading-tight">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Row 2: Type distribution */}
        {typeEntries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Donut chart */}
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center justify-center">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Distribution</span>
              <div className="relative w-36 h-36">
                <div
                  className="w-full h-full rounded-full"
                  style={{ background: conicGradient }}
                />
                <div className="absolute inset-4 rounded-full bg-card flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold">{totalDocs}</span>
                  <span className="text-[0.6rem] text-muted-foreground">documents</span>
                </div>
              </div>
              {/* Legend */}
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-4">
                {typeEntries.map((t) => (
                  <div key={t.type} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${t.bg}`} />
                    <span className="text-[0.6rem] text-muted-foreground">{t.type.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Horizontal bar chart */}
            <div className="md:col-span-2 rounded-2xl border border-border bg-card p-5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documents by Type</span>
              <div className="mt-4 space-y-3">
                {typeEntries.map((t) => {
                  const pct = Math.round((t.count / typeTotal) * 100);
                  return (
                    <div key={t.type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{t.type.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{t.count}</span>
                          <span className="text-[0.6rem] text-muted-foreground w-8 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${pct}%`, backgroundColor: t.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Stacked bar summary */}
              <div className="mt-5">
                <span className="text-[0.6rem] text-muted-foreground uppercase tracking-wider font-semibold">Composition</span>
                <div className="flex h-3 rounded-full overflow-hidden mt-1.5">
                  {typeEntries.map((t) => (
                    <div
                      key={t.type}
                      className="h-full transition-all duration-700 ease-out first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${(t.count / typeTotal) * 100}%`, backgroundColor: t.color }}
                      title={`${t.type.replace(/_/g, " ")}: ${t.count}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const retryPending = async () => {
    try {
      setRetrying(true);
      const res = await authFetch(`${API}/retry-pending`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Retry failed");
      } else {
        alert(`Processed ${data.retried} document(s).${
          data.failed?.length ? ` ${data.failed.length} still failed.` : ""
        }`);
        fetchDocuments();
        fetchDashboard();
      }
    } catch (e) {
      alert("Retry request failed: " + e.message);
    } finally {
      setRetrying(false);
    }
  };

  const isPendingFolder = (doc) =>
    (doc.client || "").toLowerCase() === "unsorted_pending" ||
    doc.is_pending_folder === true;

  // ── Client folder grid ───────
  const renderClientGrid = () => {
    const filtered = documents.filter((d) =>
      d.client.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (!filtered.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <HardDrive size={48} className="opacity-30" />
          <p className="text-sm">
            No client folders yet. Upload some documents to get started.
          </p>
        </div>
      );
    if (layoutMode === "list") {
      return (
        <div className="space-y-2">
          {filtered.map((doc, i) => {
            const pending = isPendingFolder(doc);
            return (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/50 cursor-pointer transition-all ${
                pending ? "border-amber-500/40 hover:border-amber-500/60" : "border-border hover:border-border/60"
              }`}
              onClick={() => openClientFolder(doc)}
            >
              <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${
                pending ? "bg-amber-500/10" : "bg-primary/10"
              }`}>
                {pending
                  ? <Clock size={16} className="text-amber-500" />
                  : <Folder size={16} className="text-primary fill-primary/10" />
                }
              </div>
              <span className="text-sm font-semibold text-foreground truncate flex-1">
                {pending ? "Unsorted / Pending" : doc.client.replace(/_/g, " ")}
              </span>
              {pending ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10 shrink-0"
                  disabled={retrying}
                  onClick={(e) => { e.stopPropagation(); retryPending(); }}
                >
                  {retrying ? <RefreshCw size={11} className="animate-spin mr-1" /> : <RefreshCw size={11} className="mr-1" />}
                  Process Now
                </Button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setShareTarget({ resourceType: "client", resourceId: doc.client, resourceLabel: doc.client }); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0"
                  title="Share folder"
                >
                  <Share2 size={13} />
                </button>
              )}
              <Badge
                variant="secondary"
                className={`text-[0.65rem] shrink-0 ${pending ? "border-amber-500/40 text-amber-600" : ""}`}
              >
                {doc.documents.length} Files
              </Badge>
            </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filtered.map((doc, i) => {
          const pending = isPendingFolder(doc);
          return (
          <div
            key={i}
            className={`group flex flex-col rounded-2xl border bg-card hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all overflow-hidden ${
              pending
                ? "border-amber-500/40 hover:border-amber-500/60"
                : "border-border hover:border-foreground/20"
            }`}
            onClick={() => openClientFolder(doc)}
          >
            <div className={`h-24 flex items-center justify-center ${
              pending
                ? "bg-gradient-to-br from-amber-500/10 via-muted to-amber-500/5"
                : "bg-gradient-to-br from-primary/5 via-muted to-primary/10"
            }`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                pending ? "bg-amber-500/10" : "bg-primary/10"
              }`}>
                {pending
                  ? <Clock size={24} className="text-amber-500" />
                  : <Folder size={24} className="text-primary fill-primary/10" />
                }
              </div>
            </div>
            <div className="p-3 text-center relative">
              {pending ? (
                <button
                  onClick={(e) => { e.stopPropagation(); retryPending(); }}
                  disabled={retrying}
                  className="absolute top-2 right-2 p-1 rounded-md bg-card/80 backdrop-blur-sm border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Process pending documents"
                >
                  <RefreshCw size={11} className={retrying ? "animate-spin" : ""} />
                </button>
              ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setShareTarget({ resourceType: "client", resourceId: doc.client, resourceLabel: doc.client }); }}
                className="absolute top-2 right-2 p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                title="Share folder"
              >
                <Share2 size={11} />
              </button>
              )}
              <span className="text-xs font-semibold text-foreground truncate block">
                {pending ? "Unsorted / Pending" : doc.client.replace(/_/g, " ")}
              </span>
              <Badge
                variant="secondary"
                className={`text-[0.65rem] mt-1 ${pending ? "border-amber-500/40 text-amber-600" : ""}`}
              >
                {doc.documents.length} Files
              </Badge>
            </div>
          </div>
          );
        })}
      </div>
    );
  };

  // ── Client profile header ───────
  const renderClientProfile = () => {
    if (!selectedClient) return null;
    const docs = selectedClient.documents || [];
    const docTypes = ["PAN_Card", "Aadhar_Card", "Voter_ID", "Driving_License"];
    const typeLabels = {
      PAN_Card: "PAN",
      Aadhar_Card: "Aadhaar",
      Voter_ID: "Voter ID",
      Driving_License: "DL",
    };
    const has = (type) => docs.some((d) => d.type === type);
    // Aggregate metadata: client-level first, then per-doc overlay
    const allData = {
      pan_number:      selectedClient.pan_number      || "",
      aadhaar_last4:   selectedClient.aadhaar_last4   || "",
      voter_id_number: selectedClient.voter_id_number || "",
      dl_number:       selectedClient.dl_number       || "",
      date_of_birth:   selectedClient.dob             || "",
    };
    docs.forEach((d) => {
      if (d.pan_number)      allData.pan_number      = d.pan_number;
      if (d.aadhaar_last4)   allData.aadhaar_last4   = d.aadhaar_last4;
      if (d.voter_id_number) allData.voter_id_number = d.voter_id_number;
      if (d.dl_number)       allData.dl_number       = d.dl_number;
      if (d.date_of_birth)   allData.date_of_birth   = d.date_of_birth;
    });
    return (
      <div className="rounded-2xl border border-border bg-card p-4 mb-5 flex flex-col sm:flex-row gap-4 items-start">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground shrink-0">
          {selectedClient.client.replace(/_/g, " ").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold truncate">
            {selectedClient.client.replace(/_/g, " ")}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
            {allData.date_of_birth && <span>DOB: {allData.date_of_birth}</span>}
            {allData.pan_number && <span>PAN: {allData.pan_number}</span>}
            {allData.aadhaar_last4 && <span>Aadhaar: ••••{allData.aadhaar_last4}</span>}
            {allData.voter_id_number && <span>Voter: {allData.voter_id_number}</span>}
            {allData.dl_number && <span>DL: {allData.dl_number}</span>}
          </div>
          {/* Coverage bar */}
          <div className="flex gap-2 mt-3">
            {docTypes.map((t) => (
              <div
                key={t}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.65rem] font-medium border ${
                  has(t)
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted border-border text-muted-foreground"
                }`}
              >
                {has(t) ? <CheckCircle size={9} /> : <X size={9} />}
                {typeLabels[t]}
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Badge variant="secondary" className="text-[0.65rem]">
            {docs.length} file{docs.length !== 1 ? "s" : ""}
          </Badge>
          {(
          <Button
            size="sm"
            variant={bulkMode ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => {
              setBulkMode(!bulkMode);
              setSelectedDocIds(new Set());
            }}
          >
            {bulkMode ? <X size={12} /> : <CheckSquare size={12} />}
            {bulkMode ? "Cancel" : "Select"}
          </Button>
          )}
        </div>
      </div>
    );
  };

  // ── Bulk action bar ───────
  const renderBulkBar = () => {
    if (!selectedDocIds.size) return null;
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border border-border shadow-xl rounded-2xl px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          {selectedDocIds.size} selected
        </span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
          const ids = [...selectedDocIds];
          if (!ids.length) return;
          // Build jobs from current client documents
          const allDocs = documents.flatMap((d) => d.documents);
          const jobs = ids.map((id) => {
            const doc = allDocs.find((d) => d.doc_id === id);
            return { docId: id, label: docDisplayName(doc) || "Document", preview: doc ? previewUrl(doc) : null };
          });
          addReanalyze(jobs);
          setSelectedDocIds(new Set());
          setBulkMode(false);
        }}>
          <RefreshCw size={12} /> Reanalyze
        </Button>
        {(
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleBulkAction("star")}>
          <Star size={12} /> Star
        </Button>
        )}
        {(
        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleBulkAction("trash")}>
          <Trash2 size={12} /> Trash
        </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setSelectedDocIds(new Set()); setBulkMode(false); }}>
          <X size={14} />
        </Button>
      </div>
    );
  };

  // ── File list (type-grouped, no thumbnails) ───────
  const renderFileGrid = () => {
    if (!selectedClient) return null;
    const files = selectedClient.documents || [];

    // Group files by document type
    const typeGroups = {};
    files.forEach((file) => {
      const type = file.type || "Unknown_Document";
      if (!typeGroups[type]) typeGroups[type] = [];
      typeGroups[type].push(file);
    });
    const typeEntries = Object.entries(typeGroups).sort(([a], [b]) => a.localeCompare(b));

    return (
      <>
        {renderClientProfile()}
        <div className="space-y-3">
          {typeEntries.map(([type, docs]) => (
            <div key={type} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Type section header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border-b border-border">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText size={15} className="text-primary" />
                </div>
                <span className="text-sm font-semibold flex-1">{type.replace(/_/g, " ")}</span>
                <Badge variant="secondary" className="text-[0.6rem]">
                  {docs.length} file{docs.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {/* Document rows */}
              <div className="divide-y divide-border">
                {docs.map((file, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors ${
                      selectedDocIds.has(file.doc_id) ? "bg-primary/5" : ""
                    }`}
                    onClick={() => bulkMode ? toggleDocSelect(file.doc_id) : setSelectedFile(file)}
                  >
                    {bulkMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleDocSelect(file.doc_id); }}
                        className="shrink-0 text-muted-foreground hover:text-primary"
                      >
                        {selectedDocIds.has(file.doc_id) ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                      </button>
                    )}
                    <FileImage size={16} className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{docDisplayName(file)}</span>
                      <span className="text-xs text-muted-foreground truncate block">
                        {docSubtitle(file)}
                        {file.file_size ? ` · ${Math.round(file.file_size / 1024)} KB` : ""}
                      </span>
                    </div>
                    {file.status === "pending" && (
                      <Badge variant="outline" className="text-[0.6rem] shrink-0 border-amber-500/50 text-amber-600">
                        Pending
                      </Badge>
                    )}
                    {file.status === "failed" && (
                      <Badge variant="outline" className="text-[0.6rem] shrink-0 border-red-500/50 text-red-500">
                        AI Failed
                      </Badge>
                    )}
                    {!bulkMode && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setShareTarget({ resourceType: "document", resourceId: file.doc_id, resourceLabel: docDisplayName(file) }); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors" title="Share"><Share2 size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setEditDoc({ doc: file, client: selectedClient }); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit type"><SquarePen size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleStar(file.doc_id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-amber-500 transition-colors" title={file.starred ? "Unstar" : "Star"}>{file.starred ? <Star size={13} className="fill-amber-400 text-amber-400" /> : <Star size={13} />}</button>
                        <button onClick={(e) => { e.stopPropagation(); handleReanalyze(file.doc_id, docDisplayName(file), previewUrl(file)); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Re-analyze"><RefreshCw size={13} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleTrash(file.doc_id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-colors" title="Move to trash"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!typeEntries.length && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <FileText size={40} className="opacity-30" />
              <p className="text-sm">No documents in this folder yet.</p>
            </div>
          )}
        </div>
        {renderBulkBar()}
      </>
    );
  };

  // ── Recent activity view (timeline) ───────
  const ACTION_META = {
    upload:   { icon: Upload,     color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Uploaded" },
    preview:  { icon: Eye,        color: "text-blue-500",    bg: "bg-blue-500/10",    label: "Previewed" },
    download: { icon: Download,   color: "text-violet-500",  bg: "bg-violet-500/10",  label: "Downloaded" },
    delete:   { icon: Trash2,     color: "text-red-500",     bg: "bg-red-500/10",     label: "Deleted" },
    trash:    { icon: Trash2,     color: "text-orange-500",  bg: "bg-orange-500/10",  label: "Trashed" },
    restore:  { icon: Undo2,      color: "text-teal-500",    bg: "bg-teal-500/10",    label: "Restored" },
    star:     { icon: Star,       color: "text-amber-500",   bg: "bg-amber-500/10",   label: "Starred" },
    unstar:   { icon: StarOff,    color: "text-gray-400",    bg: "bg-gray-500/10",    label: "Unstarred" },
    share:    { icon: Share2,     color: "text-indigo-500",  bg: "bg-indigo-500/10",  label: "Shared" },
  };
  const FILTER_TABS = [
    { key: "all",      label: "All" },
    { key: "upload",   label: "Uploads" },
    { key: "download", label: "Downloads" },
    { key: "preview",  label: "Previews" },
    { key: "trash",    label: "Trash" },
  ];

  const formatRelativeTime = (isoStr) => {
    try {
      const d = new Date(isoStr);
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return "just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 172800) return "yesterday";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return isoStr; }
  };

  const groupByDay = (logs) => {
    const groups = {};
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    logs.forEach((log) => {
      try {
        const d = new Date(log.accessed_at); d.setHours(0,0,0,0);
        let label;
        if (d.getTime() === today.getTime()) label = "Today";
        else if (d.getTime() === yesterday.getTime()) label = "Yesterday";
        else label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        if (!groups[label]) groups[label] = [];
        groups[label].push(log);
      } catch {
        if (!groups["Other"]) groups["Other"] = [];
        groups["Other"].push(log);
      }
    });
    return Object.entries(groups);
  };

  const renderRecent = () => {
    const dayGroups = groupByDay(recentActivity);

    return (
      <div className="space-y-4">
        {/* Filter tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActivityFilter(tab.key); fetchRecent(tab.key); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activityFilter === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!recentActivity.length ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <Activity size={48} className="opacity-30" />
            <p className="text-sm">No activity recorded yet.</p>
            <p className="text-xs">Upload, preview, or download documents to see your trail here.</p>
          </div>
        ) : (
          dayGroups.map(([dayLabel, logs]) => (
            <div key={dayLabel}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{dayLabel}</span>
                <div className="flex-1 h-px bg-border" />
                <span className="text-[0.6rem] text-muted-foreground">{logs.length} event{logs.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-1.5">
                {logs.map((log, i) => {
                  const meta = ACTION_META[log.action] || ACTION_META.preview;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted/40 cursor-pointer transition-colors group"
                      onClick={() => {
                        // Try to navigate to the document
                        const client = documents.find((d) => d.client === log.client_name);
                        if (client) {
                          const file = client.documents.find((f) => f.doc_id === log.doc_id);
                          if (file) { setSelectedClient(client); setSelectedFile(file); }
                          else openClientFolder(client);
                        }
                      }}
                    >
                      <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center shrink-0`}>
                        <Icon size={14} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{docDisplayName(log)}</span>
                          <ArrowUpRight size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {log.client_name?.replace(/_/g, " ") || ""}{log.client_name ? " · " : ""}{log.type?.replace(/_/g, " ")}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[0.6rem] shrink-0 ${meta.color} border-current/20`}
                      >
                        {meta.label}
                      </Badge>
                      <span className="text-[0.6rem] text-muted-foreground shrink-0 w-16 text-right">
                        {formatRelativeTime(log.accessed_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  // ── Manual review view ───────
  const UNKNOWN_CLIENT_NAMES_UI = new Set([
    "UNKNOWN", "UNKNOWNCLIENT", "UNKNOWNNAME", "NA", "N/A",
    "NONE", "NOTAVAILABLE", "NOTFOUND", "UNIDENTIFIED",
  ]);
  const isUnknownClient = (name) =>
    UNKNOWN_CLIENT_NAMES_UI.has((name || "").replace(/_/g, "").toUpperCase().trim());

  const renderReview = () => {
    const allDocs = reviewClients.flatMap((c) =>
      (c.documents || [])
        .filter((d) => d.needs_review || isUnknownClient(c.name))
        .map((d) => ({ ...d, clientName: c.name, clientRecord: c }))
    );
    if (!allDocs.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <CheckCircle size={48} className="opacity-30" />
          <p className="text-sm">All documents are verified. Nothing to review!</p>
        </div>
      );
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {allDocs.map((doc, i) => {
          const unknownClient = isUnknownClient(doc.clientName);
          return (
            <div
              key={i}
              className={`rounded-2xl border bg-card overflow-hidden ${
                unknownClient ? "border-orange-500/30" : "border-amber-500/30"
              }`}
            >
              <div
                className="h-40 bg-muted overflow-hidden cursor-pointer"
                onClick={() => {
                  const client = documents.find((d) => d.client === doc.clientName);
                  if (client) { setSelectedClient(client); setSelectedFile(doc); }
                }}
              >
                <CachedImage
                  firebasePath={previewKey(doc)}
                  backendUrl={previewUrl(doc)}
                  alt={docDisplayName(doc)}
                  className="w-full h-full object-cover hover:scale-105 transition-transform"
                  fallback="https://via.placeholder.com/300x160?text=Preview"
                />
              </div>
              <div className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{docDisplayName(doc)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {doc.clientName?.replace(/_/g, " ")} · {doc.type?.replace(/_/g, " ")}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[0.6rem] shrink-0 ${
                      unknownClient
                        ? "border-orange-500/50 text-orange-600"
                        : "border-amber-500/50 text-amber-600"
                    }`}
                  >
                    {unknownClient ? "Unknown" : "Review"}
                  </Badge>
                </div>
                <div className="flex gap-2 mt-2">
                  {/* UNKNOWN docs get Edit button; known docs get Confirm */}
                  {unknownClient && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      onClick={() => setEditDoc({ doc, client: doc.clientRecord })}
                    >
                      <SquarePen size={12} /> Edit &amp; Assign
                    </Button>
                  )}
                  {!unknownClient && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      onClick={async () => {
                        await authFetch(`${API}/review/confirm`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ doc_id: doc.doc_id }),
                        });
                        fetchReview();
                        fetchDashboard();
                      }}
                    >
                      <CheckCircle size={12} /> Confirm
                    </Button>
                  )}
                  {(
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    onClick={() => {
                      handleReanalyze(doc.doc_id, docDisplayName(doc), previewUrl(doc));
                    }}
                  >
                    <RefreshCw size={12} /> Re-analyze
                  </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Search results view ───────
  const renderSearchResults = () => {
    if (!searchResults || !searchResults.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Search size={48} className="opacity-30" />
          <p className="text-sm">
            No results found for "{searchQuery}".
          </p>
        </div>
      );
    return (
      <div className="space-y-2">
        {searchResults.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => {
              // Find the client and the file, open preview
              const client = documents.find(
                (d) => d.client === r.client_name
              );
              if (client) {
                const file = client.documents.find(
                  (f) => f.doc_id === r.doc_id
                );
                if (file) {
                  setSelectedClient(client);
                  setSelectedFile(file);
                }
              }
            }}
          >
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
              <FileImage size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{docDisplayName(r)}</p>
              <p className="text-xs text-muted-foreground">
                {r.client_name?.replace(/_/g, " ")} ·{" "}
                {r.type?.replace(/_/g, " ")}
                {r.uploaded_at ? ` · ${r.uploaded_at}` : ""}
              </p>
            </div>
            <Badge variant="secondary" className="text-[0.6rem] shrink-0">
              {r.type?.replace(/_/g, " ")}
            </Badge>
          </div>
        ))}
      </div>
    );
  };

  // ── Starred view ───────
  const renderStarred = () => {
    if (!starredDocs.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Star size={48} className="opacity-30" />
          <p className="text-sm font-medium">No starred documents yet.</p>
          <p className="text-xs">Star documents from inside a client folder for quick access here.</p>
        </div>
      );
    return (
      <div className="space-y-2">
        {starredDocs.map((file, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => setSelectedFile(file)}
          >
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Star size={16} className="text-amber-500 fill-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold truncate block">{docDisplayName(file)}</span>
              <span className="text-xs text-muted-foreground truncate block">
                {file.client_name?.replace(/_/g, " ")} · {docSubtitle(file)}
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleStar(file.doc_id); }}
              className="p-1.5 rounded-lg hover:bg-muted text-amber-400 hover:text-muted-foreground transition-colors shrink-0"
              title="Unstar"
            >
              <StarOff size={14} />
            </button>
            <Badge variant="secondary" className="text-[0.6rem] shrink-0">
              {file.type?.replace(/_/g, " ")}
            </Badge>
          </div>
        ))}
      </div>
    );
  };

  // ── Trash view ───────
  const renderTrash = () => {
    if (!trashedDocs.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Trash2 size={48} className="opacity-30" />
          <p className="text-sm font-medium">Trash is empty.</p>
          <p className="text-xs">Documents you delete will appear here before being permanently removed.</p>
        </div>
      );
    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-muted-foreground">{trashedDocs.length} item{trashedDocs.length !== 1 ? "s" : ""} in trash</span>
          {confirmEmptyTrash ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">
                Permanently delete {trashedDocs.length} item{trashedDocs.length !== 1 ? "s" : ""}?
              </span>
              <Button size="sm" variant="destructive" className="h-7 text-xs"
                onClick={async () => {
                  const ids = trashedDocs.map((d) => d.doc_id);
                  await authFetch(`${API}/documents/bulk`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "delete_permanent", doc_ids: ids }),
                  });
                  setConfirmEmptyTrash(false);
                  fetchTrash();
                  refreshAll();
                }}
              >Yes, Delete All</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => setConfirmEmptyTrash(false)}>Cancel</Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => setConfirmEmptyTrash(true)}
            >
              <Trash2 size={12} /> Empty Trash
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {trashedDocs.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card opacity-75 hover:opacity-100 transition-opacity"
            >
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Trash2 size={16} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold truncate block">{docDisplayName(file)}</span>
                <span className="text-xs text-muted-foreground truncate block">
                  {file.client_name?.replace(/_/g, " ")} · {docSubtitle(file)}
                </span>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleRestore(file.doc_id)}>
                  <Undo2 size={12} /> Restore
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={() => handlePurge(file.doc_id)}>
                  <Trash2 size={12} /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  // ── Placeholder views ───────
  const renderPlaceholder = (icon, title, desc) => (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs">{desc}</p>
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Storage</p>
            <p className="text-xs text-muted-foreground mt-1">
              Choose where new uploads are stored. You can switch later.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Current: {storageMode === "gdrive" ? "Google Drive" : "Firebase"}
          </div>
        </div>

        {settingsError && (
          <p className="text-xs text-destructive mt-3">{settingsError}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant={storageMode === "firebase" ? "default" : "outline"}
            onClick={() => updateStorageMode("firebase")}
            disabled={settingsBusy}
          >
            Use Firebase
          </Button>
          <Button
            variant={storageMode === "gdrive" ? "default" : "outline"}
            onClick={() => updateStorageMode("gdrive")}
            disabled={settingsBusy || !hasGdrive}
          >
            Use Google Drive
          </Button>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <Button variant="outline" onClick={handleConnectDrive} disabled={settingsBusy}>
            Connect Google Drive
          </Button>
          {!hasGdrive && (
            <span className="text-xs text-muted-foreground">
              Connect to enable Google Drive storage.
            </span>
          )}
        </div>
      </div>

      {/* Danger Zone: Wipe All Data */}
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Danger Zone</p>
            <p className="text-xs text-muted-foreground mt-1">
              Permanently delete all documents, clients, and activity. Your account stays intact.
            </p>
          </div>
        </div>

        {showWipeConfirm ? (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
              This cannot be undone. Delete everything?
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-8 text-xs"
              onClick={handleWipe}
              disabled={wiping}
            >
              {wiping ? "Deleting..." : "Yes, Wipe Everything"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setShowWipeConfirm(false)}
              disabled={wiping}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-red-600 border-red-500/50 hover:bg-red-500/10 dark:text-red-400"
              onClick={() => setShowWipeConfirm(true)}
            >
              <Trash2 size={12} className="mr-1" /> Wipe All Data
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // ── View title ───────
  const viewTitles = {
    home: "My Cloud",
    recent: "Recent Activity",
    shared: "Shared with me",
    review: "Manual Review",
    starred: "Starred",
    trash: "Trash",
    search: `Search Results`,
    settings: "Settings",
    "client-view": selectedClient?.client?.replace(/_/g, " "),
  };

  return (
    <>
      <DashboardShell
      activeView={
        ["home", "client-view", "search"].includes(viewState)
          ? "home"
          : viewState
      }
      onNavigate={(view) => {
        setViewState(view);
        setSelectedClient(null);
        setSearchResults(null);
        if (view !== "search") setSearchQuery("");
      }}
      onOpenSettings={() => {
        setViewState("settings");
        setSelectedClient(null);
        setSearchResults(null);
        setSearchQuery("");
      }}
      onLogout={() => {
        clearPreviewCache();
        auth.signOut();
        setFirebaseUser(null);
        navigate("/login");
      }}
      user={
        firebaseUser
          ? { name: firebaseUser.displayName, email: firebaseUser.email }
          : null
      }
      searchQuery={searchQuery}
      onSearchChange={(v) => {
        setSearchQuery(v);
        if (!v.trim()) setSearchResults(null);
      }}
      onSearchSubmit={handleSearch}
      onLogoClick={goHome}
    >
      {/* Stats + visualization — only on home view */}
      {viewState === "home" && !loading && renderDashboard()}

      {/* Stats row — only on client-view */}
      {viewState === "client-view" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map(({ icon: Icon, value, label }, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-foreground shrink-0">
                <Icon size={20} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold leading-tight">
                  {value}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumb header */}
      {viewState !== "search" && (
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {viewState === "client-view" ? (
              <>
                <button
                  onClick={goHome}
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  Home
                </button>
                <ChevronRight size={14} className="text-muted-foreground" />
                <span className="text-foreground font-semibold">
                  {selectedClient?.client.replace(/_/g, " ")}
                </span>
              </>
            ) : (
              <span className="text-foreground font-semibold">
                {viewTitles[viewState] || "My Cloud"}
              </span>
            )}
          </div>
          {/* Layout toggle */}
          {viewState === "home" && (
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <Button
                variant={layoutMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setLayoutMode("grid")}
                title="Grid view"
              >
                <LayoutGrid size={14} />
              </Button>
              <Button
                variant={layoutMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setLayoutMode("list")}
                title="List view"
              >
                <List size={14} />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Search results header */}
      {viewState === "search" && (
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={goHome}
            className="text-muted-foreground hover:text-primary transition-colors text-sm"
          >
            ← Back
          </button>
          <span className="text-foreground font-semibold text-sm">
            Results for "{searchQuery}"
            {searchResults && (
              <span className="text-muted-foreground font-normal">
                {" "}
                ({searchResults.length})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Main content */}
      {loading && viewState === "home" ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <p className="text-sm">Syncing with Vaultify Brain...</p>
        </div>
      ) : viewState === "home" ? (
        renderClientGrid()
      ) : viewState === "client-view" ? (
        renderFileGrid()
      ) : viewState === "recent" ? (
        renderRecent()
      ) : viewState === "review" ? (
        renderReview()
      ) : viewState === "settings" ? (
        renderSettings()
      ) : viewState === "search" ? (
        renderSearchResults()
      ) : viewState === "starred" ? (
        renderStarred()
      ) : viewState === "trash" ? (
        renderTrash()
      ) : viewState === "shared" ? (
        <SharedWithMe
          authToken={authToken}
          onPreviewShared={(doc, share) => setSharedPreviewDoc({ doc, share })}
        />
      ) : null}

      {/* Preview modal — own vault documents */}
      {selectedFile && (
        <PreviewModal
          file={selectedFile}
          clientName={selectedClient?.client}
          onClose={() => setSelectedFile(null)}
          onRefresh={fetchDocuments}
          onReanalyze={() => { handleReanalyze(selectedFile.doc_id, docDisplayName(selectedFile), previewUrl(selectedFile)); setSelectedFile(null); }}
          onEdit={() => { setEditDoc({ doc: selectedFile, client: selectedClient }); setSelectedFile(null); }}
          previewSrc={previewUrl(selectedFile)}
          firebasePath={previewKey(selectedFile)}
          backendUrl={previewUrl(selectedFile)}
          canDownload={true}
          canDelete={true}
          canReanalyze={true}
        />
      )}

      {/* Preview modal — shared documents (read-only) */}
      {sharedPreviewDoc && (
        <PreviewModal
          file={sharedPreviewDoc.doc}
          clientName={sharedPreviewDoc.share?.owner_name || "Shared"}
          onClose={() => setSharedPreviewDoc(null)}
          onRefresh={() => {}}
          previewSrc={`${API}/shared/preview?doc_id=${encodeURIComponent(sharedPreviewDoc.doc.doc_id)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`}
          firebasePath={`shared_${sharedPreviewDoc.doc.doc_id}`}
          backendUrl={`${API}/shared/preview?doc_id=${encodeURIComponent(sharedPreviewDoc.doc.doc_id)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`}
          canDownload={sharedPreviewDoc.share?.permission === "editor"}
          canDelete={false}
          canReanalyze={false}
          isShared={true}
          sharePermission={sharedPreviewDoc.share?.permission}
          sharedDocId={sharedPreviewDoc.doc.doc_id}
        />
      )}

      {/* Share dialog */}
      {shareTarget && (
        <ShareDialog
          resourceType={shareTarget.resourceType}
          resourceId={shareTarget.resourceId}
          resourceLabel={shareTarget.resourceLabel}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* Edit / type-override modal */}
      {editDoc && (
        <EditDocModal
          doc={editDoc.doc}
          client={editDoc.client}
          onClose={() => setEditDoc(null)}
          onSaved={() => { setEditDoc(null); refreshAll(); }}
          onReanalyze={() => { setEditDoc(null); handleReanalyze(editDoc.doc.doc_id, docDisplayName(editDoc.doc), previewUrl(editDoc.doc)); }}
          previewSrc={previewUrl(editDoc.doc)}
          firebasePath={previewKey(editDoc.doc)}
          backendUrl={previewUrl(editDoc.doc)}
        />
      )}

      {/* Upload FAB + modal */}
      <UploadModal />
    </DashboardShell>
    <UploadTray />
    </>
  );
};

// ─── PROTECTED DASHBOARD ROUTE (outer – provides UploadProvider context) ─────────
const DashboardRoute = ({ firebaseUser, setFirebaseUser }) => {
  const refreshRef = React.useRef(() => {});
  return (
    <UploadProvider onFileSuccess={() => refreshRef.current?.()}>
      <DashboardContent
        firebaseUser={firebaseUser}
        setFirebaseUser={setFirebaseUser}
        refreshRef={refreshRef}
      />
    </UploadProvider>
  );
};

// ─── MAIN APP ────────────────────────────────────────────────────
function App() {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [verifyData, setVerifyData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user && user.emailVerified) {
        setFirebaseUser(user);
      }
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  if (!authReady) return null;

  const isAuthed = !!firebaseUser;

  return (
    <Routes>
      {/* Public: auth pages */}
      <Route
        path="/login"
        element={
          isAuthed ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <LoginForm
              onLogin={(u) => {
                setFirebaseUser(u);
                navigate("/dashboard");
              }}
              onGoRegister={() => navigate("/register")}
              onGoForgotPassword={() => navigate("/forgot-password")}
            />
          )
        }
      />

      <Route
        path="/register"
        element={
          isAuthed ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <RegisterForm
              onGoLogin={() => navigate("/login")}
              onGoVerify={(data) => {
                setVerifyData(data);
                navigate("/verify-email");
              }}
            />
          )
        }
      />

      <Route
        path="/verify-email"
        element={
          <VerifyEmailPage
            email={verifyData?.email}
            password={verifyData?.password}
            onSuccess={(u) => {
              setFirebaseUser(u);
              setVerifyData(null);
              navigate("/dashboard");
            }}
            onBack={() => navigate("/register")}
          />
        }
      />

      <Route
        path="/forgot-password"
        element={
          <ForgotPasswordPage
            onBackToLogin={() => navigate("/login")}
          />
        }
      />

      {/* Firebase action handler */}
      <Route path="/auth/action" element={<FirebaseActionRouter />} />

      {/* Protected: dashboard */}
      <Route
        path="/dashboard"
        element={
          isAuthed ? (
            <DashboardRoute
              firebaseUser={firebaseUser}
              setFirebaseUser={setFirebaseUser}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Default redirect */}
      <Route
        path="*"
        element={<DefaultRedirect isAuthed={isAuthed} />}
      />
    </Routes>
  );
}

// Handle root `/` and any Firebase action params
const DefaultRedirect = ({ isAuthed }) => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode");

  if (oobCode && mode === "verifyEmail") return <VerifyActionPage />;
  if (oobCode && mode === "resetPassword") return <ResetPasswordRoute />;

  return <Navigate to={isAuthed ? "/dashboard" : "/login"} replace />;
};

export default App;
