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
import { UploadProvider } from "@/contexts/UploadContext";

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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

// ─── PROTECTED DASHBOARD ROUTE ───────────────────────────────────
const DashboardRoute = ({ firebaseUser, setFirebaseUser }) => {
  const navigate = useNavigate();
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

  const previewUrl = (firebasePath) =>
    `${API}/preview?path=${encodeURIComponent(firebasePath)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;

  // Derive display name from Firebase path (e.g. "uid/folder/Client_PAN_Card.webp" → "Client PAN Card")
  const docDisplayName = (file) => {
    if (!file?.firebase_path) return file?.filename || "Document";
    return file.firebase_path.split("/").pop().replace(/\.webp$/i, "").replace(/_/g, " ");
  };

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
        });
      }
    } catch {}
  };

  const fetchRecent = async () => {
    try {
      const res = await authFetch(`${API}/activity/recent?limit=20`);
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

  const handleReanalyze = async (docId) => {
    try {
      await authFetch(`${API}/review/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId }),
      });
      refreshAll();
    } catch (e) {
      console.error("Reanalyze failed:", e);
    }
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
  ];

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
          {filtered.map((doc, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:border-border/60 hover:bg-muted/50 cursor-pointer transition-all"
              onClick={() => openClientFolder(doc)}
            >
              <div className="w-9 h-9 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {doc.documents.length > 0 ? (
                  <img
                    src={previewUrl(doc.documents[0].firebase_path)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                ) : (
                  <Folder size={16} className="text-primary fill-primary/10" />
                )}
              </div>
              <span className="text-sm font-semibold text-foreground truncate flex-1">
                {doc.client.replace(/_/g, " ")}
              </span>
              <Badge variant="secondary" className="text-[0.65rem] shrink-0">
                {doc.documents.length} Files
              </Badge>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filtered.map((doc, i) => (
          <div
            key={i}
          className="flex flex-col rounded-2xl border border-border bg-card hover:border-foreground/20 hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all overflow-hidden"
            onClick={() => openClientFolder(doc)}
          >
            <div className="h-24 bg-muted flex items-center justify-center overflow-hidden">
              {doc.documents.length > 0 ? (
                <img
                  src={previewUrl(doc.documents[0].firebase_path)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              ) : (
                <Folder size={36} className="text-primary/30" />
              )}
            </div>
            <div className="p-3 text-center">
              <span className="text-xs font-semibold text-foreground truncate block">
                {doc.client.replace(/_/g, " ")}
              </span>
              <Badge variant="secondary" className="text-[0.65rem] mt-1">
                {doc.documents.length} Files
              </Badge>
            </div>
          </div>
        ))}
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
    // Aggregate metadata from docs
    const allData = {};
    docs.forEach((d) => {
      if (d.pan_number) allData.pan_number = d.pan_number;
      if (d.aadhaar_last4) allData.aadhaar_last4 = d.aadhaar_last4;
      if (d.voter_id_number) allData.voter_id_number = d.voter_id_number;
      if (d.dl_number) allData.dl_number = d.dl_number;
      if (d.date_of_birth) allData.date_of_birth = d.date_of_birth;
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
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleBulkAction("reanalyze")}>
          <RefreshCw size={12} /> Reanalyze
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleBulkAction("star")}>
          <Star size={12} /> Star
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleBulkAction("trash")}>
          <Trash2 size={12} /> Trash
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setSelectedDocIds(new Set()); setBulkMode(false); }}>
          <X size={14} />
        </Button>
      </div>
    );
  };

  // ── File grid ───────
  const renderFileGrid = () => {
    if (!selectedClient) return null;
    const files = selectedClient.documents || [];
    if (layoutMode === "list") {
      return (
        <>
          {renderClientProfile()}
          <div className="space-y-2">
            {files.map((file, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/50 cursor-pointer transition-all ${
                  selectedDocIds.has(file.doc_id) ? "border-primary/60 bg-primary/5" : "border-border hover:border-foreground/20"
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
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={previewUrl(file.firebase_path)}
                    alt={docDisplayName(file)}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.src = "https://via.placeholder.com/40?text=DOC"; }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold truncate block">{docDisplayName(file)}</span>
                  <span className="text-xs text-muted-foreground">{file.type.replace(/_/g, " ")}</span>
                </div>
                {!bulkMode && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); setEditDoc({ doc: file, client: selectedClient }); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit type"><SquarePen size={13} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleStar(file.doc_id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-amber-500 transition-colors" title={file.starred ? "Unstar" : "Star"}>{file.starred ? <Star size={13} className="fill-amber-400 text-amber-400" /> : <Star size={13} />}</button>
                    <button onClick={(e) => { e.stopPropagation(); handleReanalyze(file.doc_id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Re-analyze"><RefreshCw size={13} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleTrash(file.doc_id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-colors" title="Move to trash"><Trash2 size={13} /></button>
                  </div>
                )}
                <Badge variant="secondary" className="text-[0.6rem] shrink-0">
                  {file.type.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </div>
          {renderBulkBar()}
        </>
      );
    }
    return (
      <>
        {renderClientProfile()}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {files.map((file, i) => (
            <div
              key={i}
              className={`group relative flex flex-col rounded-2xl border bg-card overflow-hidden hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all ${
                selectedDocIds.has(file.doc_id) ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-foreground/20"
              }`}
              onClick={() => bulkMode ? toggleDocSelect(file.doc_id) : setSelectedFile(file)}
            >
              <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
                <img
                  src={previewUrl(file.firebase_path)}
                  alt={docDisplayName(file)}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  onError={(e) => { e.target.src = "https://via.placeholder.com/150?text=DOC"; }}
                />
              </div>
              {/* Checkbox overlay (bulk) */}
              {(bulkMode || selectedDocIds.has(file.doc_id)) && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleDocSelect(file.doc_id); }}
                  className="absolute top-1.5 left-1.5 p-0.5 rounded-md bg-card/80 backdrop-blur-sm"
                >
                  {selectedDocIds.has(file.doc_id) ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="text-muted-foreground" />}
                </button>
              )}
              {/* Action overlays */}
              {!bulkMode && (
                <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); setEditDoc({ doc: file, client: selectedClient }); }} className="p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-card transition-colors" title="Edit type"><SquarePen size={11} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleStar(file.doc_id); }} className="p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-amber-500 transition-colors" title={file.starred ? "Unstar" : "Star"}>{file.starred ? <Star size={11} className="fill-amber-400 text-amber-400" /> : <Star size={11} />}</button>
                  <button onClick={(e) => { e.stopPropagation(); handleReanalyze(file.doc_id); }} className="p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-muted-foreground transition-colors" title="Re-analyze"><RefreshCw size={11} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleTrash(file.doc_id); }} className="p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-destructive transition-colors" title="Move to trash"><Trash2 size={11} /></button>
                </div>
              )}
              <div className="p-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold truncate">
                  {docDisplayName(file)}
                </span>
                <Badge variant="secondary" className="w-fit text-[0.6rem]">
                  {file.type.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        {renderBulkBar()}
      </>
    );
  };

  // ── Recent activity view ───────
  const renderRecent = () => {
    if (!recentActivity.length)
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Clock size={48} className="opacity-30" />
          <p className="text-sm">No recent activity yet.</p>
        </div>
      );
    return (
      <div className="space-y-2">
        {recentActivity.map((log, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
              {log.action === "upload" ? (
                <FileImage size={16} />
              ) : log.action === "download" ? (
                <FileText size={16} />
              ) : (
                <Clock size={16} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{docDisplayName(log)}</p>
              <p className="text-xs text-muted-foreground">
                {log.type?.replace(/_/g, " ")} · {log.action} ·{" "}
                {log.accessed_at}
              </p>
            </div>
            <Badge variant="outline" className="text-[0.6rem] shrink-0">
              {log.action}
            </Badge>
          </div>
        ))}
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
                <img
                  src={previewUrl(doc.firebase_path)}
                  alt={docDisplayName(doc)}
                  className="w-full h-full object-cover hover:scale-105 transition-transform"
                  onError={(e) => { e.target.src = "https://via.placeholder.com/300x160?text=Preview"; }}
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
                  {unknownClient ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      onClick={() => setEditDoc({ doc, client: doc.clientRecord })}
                    >
                      <SquarePen size={12} /> Edit &amp; Assign
                    </Button>
                  ) : (
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    onClick={async () => {
                      await authFetch(`${API}/review/reanalyze`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ doc_id: doc.doc_id }),
                      });
                      fetchReview();
                      fetchDocuments();
                    }}
                  >
                    <RefreshCw size={12} /> Re-analyze
                  </Button>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {starredDocs.map((file, i) => (
          <div
            key={i}
            className="group relative flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-foreground/20 hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
            onClick={() => setSelectedFile(file)}
          >
            <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
              <img
                src={previewUrl(file.firebase_path)}
                alt={docDisplayName(file)}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                onError={(e) => { e.target.src = "https://via.placeholder.com/150?text=DOC"; }}
              />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleStar(file.doc_id); }}
              className="absolute top-1.5 right-1.5 p-1 rounded-md bg-card/80 backdrop-blur-sm border border-border opacity-0 group-hover:opacity-100 transition-opacity text-amber-400 hover:text-muted-foreground"
              title="Unstar"
            >
              <StarOff size={11} />
            </button>
            <div className="p-3 flex flex-col gap-1">
              <span className="text-xs font-semibold truncate">{docDisplayName(file)}</span>
              <span className="text-[0.65rem] text-muted-foreground truncate">{file.client_name?.replace(/_/g, " ")}</span>
              <Badge variant="secondary" className="w-fit text-[0.6rem] mt-0.5">{file.type?.replace(/_/g, " ")}</Badge>
            </div>
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={async () => {
              for (const d of trashedDocs) await handlePurge(d.doc_id);
            }}
          >
            <Trash2 size={12} /> Empty Trash
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {trashedDocs.map((file, i) => (
            <div key={i} className="flex flex-col rounded-2xl border border-border bg-card overflow-hidden opacity-75 hover:opacity-100 transition-opacity">
              <div className="h-28 bg-muted flex items-center justify-center overflow-hidden">
                <img
                  src={previewUrl(file.firebase_path)}
                  alt={docDisplayName(file)}
                  className="w-full h-full object-cover grayscale"
                  onError={(e) => { e.target.src = "https://via.placeholder.com/150?text=DOC"; }}
                />
              </div>
              <div className="p-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold truncate">{docDisplayName(file)}</span>
                <span className="text-[0.65rem] text-muted-foreground">{file.deleted_at}</span>
                <div className="flex gap-1.5 mt-1">
                  <Button size="sm" variant="outline" className="h-6 text-[0.65rem] flex-1 px-1" onClick={() => handleRestore(file.doc_id)}>
                    <Undo2 size={10} /> Restore
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[0.65rem] flex-1 px-1 text-destructive hover:text-destructive" onClick={() => handlePurge(file.doc_id)}>
                    <Trash2 size={10} /> Delete
                  </Button>
                </div>
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

  // ── View title ───────
  const viewTitles = {
    home: "My Cloud",
    recent: "Recent Activity",
    review: "Manual Review",
    starred: "Starred",
    trash: "Trash",
    search: `Search Results`,
    "client-view": selectedClient?.client?.replace(/_/g, " "),
  };

  return (
    <UploadProvider onFileSuccess={refreshAll}>
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
      onLogout={() => {
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
      {/* Stats row — only on home/client views */}
      {["home", "client-view"].includes(viewState) && (
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
          {["home", "client-view"].includes(viewState) && (
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
      ) : viewState === "search" ? (
        renderSearchResults()
      ) : viewState === "starred" ? (
        renderStarred()
      ) : viewState === "trash" ? (
        renderTrash()
      ) : null}

      {/* Preview modal */}
      {selectedFile && (
        <PreviewModal
          file={selectedFile}
          clientName={selectedClient?.client}
          onClose={() => setSelectedFile(null)}
          onRefresh={fetchDocuments}
          onReanalyze={() => { handleReanalyze(selectedFile.doc_id); setSelectedFile(null); }}
          previewSrc={previewUrl(selectedFile.firebase_path)}
        />
      )}

      {/* Edit / type-override modal */}
      {editDoc && (
        <EditDocModal
          doc={editDoc.doc}
          client={editDoc.client}
          onClose={() => setEditDoc(null)}
          onSaved={() => { setEditDoc(null); refreshAll(); }}
          onReanalyze={() => { setEditDoc(null); handleReanalyze(editDoc.doc.doc_id); }}
          previewSrc={previewUrl(editDoc.doc.firebase_path)}
        />
      )}

      {/* Upload FAB + modal */}
      <UploadModal />
    </DashboardShell>
    <UploadTray />
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
