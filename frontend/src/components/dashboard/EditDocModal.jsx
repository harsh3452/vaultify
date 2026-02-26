import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Save, RefreshCw, User, Calendar, CreditCard,
  Hash, Car, Vote, ZoomIn, ZoomOut, Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch, API } from "@/lib/api";
import { useCachedPreview } from "@/components/ui/CachedImage";

const DOC_TYPES = [
  { key: "PAN_Card",        label: "PAN Card" },
  { key: "Aadhar_Card",     label: "Aadhaar" },
  { key: "Voter_ID",        label: "Voter ID" },
  { key: "Driving_License", label: "DL" },
  { key: "Unsorted",        label: "Unsorted" },
];

const TYPE_FIELDS = {
  PAN_Card:        [{ key: "pan_number",      label: "PAN Number",            icon: CreditCard, placeholder: "e.g. ABCDE1234F",   upper: true }],
  Aadhar_Card:     [{ key: "aadhaar_last4",   label: "Aadhaar Last 4 Digits", icon: Hash,       placeholder: "e.g. 5678",          upper: false }],
  Voter_ID:        [{ key: "voter_id_number", label: "Voter ID Number",       icon: Vote,       placeholder: "e.g. ABC1234567",    upper: true }],
  Driving_License: [{ key: "dl_number",       label: "DL Number",             icon: Car,        placeholder: "e.g. MH1234567890",  upper: true }],
  Unsorted:        [],
};

const ALWAYS_UNKNOWN = new Set([
  "", "UNKNOWN", "UNKNOWNCLIENT", "UNKNOWNNAME", "NA", "NA",
  "NONE", "NOTAVAILABLE", "NOTFOUND", "UNIDENTIFIED",
]);

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const EditDocModal = ({ doc, client, onClose, onSaved, onReanalyze, previewSrc, firebasePath, backendUrl }) => {
  const cachedSrc = useCachedPreview(firebasePath, backendUrl);
  const imgSrc = cachedSrc || previewSrc; // fallback to previewSrc if cache not ready
  const rawName   = (client?.name || "").replace(/_/g, "").trim().toUpperCase();
  const isUnknown = ALWAYS_UNKNOWN.has(rawName);

  const [docType, setDocType] = useState(doc?.type || "Unsorted");
  const [fields,  setFields]  = useState({
    name:            isUnknown ? "" : (client?.name?.replace(/_/g, " ") || ""),
    dob:             client?.dob             || "",
    pan_number:      client?.pan_number      || "",
    aadhaar_last4:   client?.aadhaar_last4   || "",
    voter_id_number: client?.voter_id_number || "",
    dl_number:       client?.dl_number       || "",
  });
  const [saving, setSaving] = useState(false);

  // ── Zoom / pan state ──
  const [zoom,    setZoom]    = useState(1);
  const [pan,     setPan]     = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef(null);
  const imgContainerRef = useRef(null);

  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  const fitZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Wheel zoom (scroll = zoom, like photo viewers; also works with trackpad pinch via ctrlKey)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.ctrlKey
      ? -e.deltaY * 0.01        // trackpad pinch (ctrlKey is set by browser on pinch)
      : -e.deltaY * 0.002;      // mouse wheel / trackpad scroll
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

  const setField = (key, val) => setFields((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await authFetch(`${API}/documents/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: doc.doc_id, type: docType, ...fields }),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("EditDocModal save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleReanalyze = () => {
    // Delegate to parent which routes through the upload/reanalyze tray context
    onReanalyze?.();
  };

  const extraFields = TYPE_FIELDS[docType] || [];

  return (
    <div
      className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* ── Two-panel dialog ── */}
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-row"
        style={{ width: "min(96vw, 860px)", height: "min(90vh, 640px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ══ LEFT: Zoomable image panel ══ */}
        <div
          ref={imgContainerRef}
          className="relative flex-1 bg-black/80 overflow-hidden select-none"
          style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {imgSrc ? (
            <img
              src={imgSrc}
              alt="Document preview"
              draggable={false}
              style={{
                position:  "absolute",
                top:       "50%",
                left:      "50%",
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                transformOrigin: "center center",
                maxWidth:  "none",
                maxHeight: "none",
                width:     "100%",
                height:    "100%",
                objectFit: "contain",
                transition: isDragging ? "none" : "transform 0.08s ease-out",
              }}
              onError={(e) => { e.target.style.display = "none"; }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              No preview
            </div>
          )}

          {/* Zoom controls — bottom-left */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-xl px-2 py-1.5">
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
          <div className="absolute top-2 left-2 text-[0.6rem] text-white/40 pointer-events-none">
            Scroll to zoom · drag to pan
          </div>
        </div>

        {/* ══ RIGHT: Form panel ══ */}
        <div className="flex flex-col w-[320px] shrink-0 border-l border-border">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h3 className="font-semibold text-sm">Edit Document</h3>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5 leading-tight">
                Correct classification &amp; identity data
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>

          {/* Scrollable form */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* Doc type grid */}
            <div className="space-y-2">
              <label className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider">
                Document Type
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {DOC_TYPES.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDocType(key)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center ${
                      docType === key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-border" />

            {/* Name + DOB */}
            <div className="space-y-2">
              <label className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider">
                Identity Info
              </label>
              <Field icon={User} value={fields.name}
                onChange={(v) => setField("name", v)}
                placeholder="Full name" />
              <Field icon={Calendar} value={fields.dob}
                onChange={(v) => setField("dob", v)}
                placeholder="Date of birth (e.g. 15/08/1990)" />
            </div>

            {/* Type-specific field */}
            {extraFields.length > 0 && (
              <div className="space-y-2">
                <label className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider">
                  {DOC_TYPES.find((t) => t.key === docType)?.label} Details
                </label>
                {extraFields.map(({ key, label, icon: Icon, placeholder, upper }) => (
                  <Field key={key} icon={Icon} value={fields[key]}
                    onChange={(v) => setField(key, upper ? v.toUpperCase() : v)}
                    placeholder={placeholder} mono />
                ))}
              </div>
            )}

            {/* All fields collapsible */}
            <details className="group">
              <summary className="text-[0.65rem] text-muted-foreground cursor-pointer select-none hover:text-foreground list-none flex items-center gap-1.5">
                <span className="group-open:rotate-90 transition-transform inline-block text-[0.55rem]">▶</span>
                All stored ID fields
              </summary>
              <div className="mt-2 space-y-1.5 pl-3 border-l border-border">
                {[
                  { key: "pan_number",      label: "PAN",           icon: CreditCard, upper: true },
                  { key: "aadhaar_last4",   label: "Aadhaar Last4", icon: Hash,       upper: false },
                  { key: "voter_id_number", label: "Voter ID",      icon: Vote,       upper: true },
                  { key: "dl_number",       label: "DL Number",     icon: Car,        upper: true },
                ].map(({ key, label, icon: Icon, upper }) => (
                  <Field key={key} icon={Icon} value={fields[key]}
                    onChange={(v) => setField(key, upper ? v.toUpperCase() : v)}
                    placeholder={label} mono small />
                ))}
              </div>
            </details>
          </div>

          {/* Footer actions */}
          <div className="shrink-0 flex gap-2 px-4 pb-4 pt-3 border-t border-border bg-card">
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={handleReanalyze} disabled={saving}>
              <RefreshCw size={12} />
              Re-analyze
            </Button>
            <Button className="flex-1 h-8 text-xs" onClick={handleSave} disabled={saving}>
              <Save size={12} />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Shared field component ─────────────────────────────────────────
const Field = ({ icon: Icon, value, onChange, placeholder, mono, small }) => (
  <div className="relative">
    <Icon size={small ? 11 : 13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground ${
        small  ? "pl-6 pr-2 h-7 text-xs"  : "pl-8 pr-3 h-8 text-sm"
      } ${mono ? "font-mono" : ""}`}
    />
  </div>
);

export default EditDocModal;

