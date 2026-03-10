import React, { useState, useEffect, useCallback } from "react";
import {
  Share2,
  Folder,
  FileImage,
  Eye,
  Download,
  User,
  Loader,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";
import CachedImage from "@/components/ui/CachedImage";

/**
 * SharedWithMe — Google Drive-style "Shared with me" view.
 *
 * Props:
 *   authToken       – for building preview URLs
 *   onPreviewShared – (doc, share) callback to open shared preview
 */
const SharedWithMe = ({ authToken, onPreviewShared }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // When a shared client folder is opened
  const [openFolder, setOpenFolder] = useState(null); // { share, docs, clientName, permission, ownerName }

  const fetchShared = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/auth/shared-with-me`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchShared();
  }, [fetchShared]);

  const openClientFolder = async (item) => {
    try {
      const res = await authFetch(
        `${API}/shared/client-docs?share_id=${encodeURIComponent(item.share_id)}`
      );
      if (res.ok) {
        const data = await res.json();
        setOpenFolder({
          share: item,
          docs: data.documents || [],
          clientName: data.client_name,
          permission: data.permission,
          ownerName: data.owner_name,
        });
      }
    } catch {}
  };

  const sharedPreviewUrl = (firebasePath, ownerId) =>
    `${API}/shared/preview?doc_id=__DOC_ID__${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;

  // Build a preview URL using the shared/preview endpoint (needs doc_id)
  const sharedPreviewUrlById = (docId) =>
    `${API}/shared/preview?doc_id=${encodeURIComponent(docId)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`;

  // ── Folder detail view ──
  if (openFolder) {
    const { docs, clientName, permission, ownerName, share } = openFolder;
    return (
      <div>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => setOpenFolder(null)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <ChevronRight size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">
            {clientName?.replace(/_/g, " ")}
          </span>
          <Badge variant="outline" className="text-[0.6rem] ml-1">
            {permission === "editor" ? "Can download" : "View only"}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Shared by {ownerName || share.owner_email}
        </p>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
            <FileImage size={48} className="opacity-30" />
            <p className="text-sm">No documents in this shared folder.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {docs.map((doc, i) => (
              <div
                key={doc.doc_id || i}
                className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-foreground/20 hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
                onClick={() =>
                  onPreviewShared?.(doc, {
                    ...share,
                    permission,
                    owner_id: share.owner_id,
                  })
                }
              >
                <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
                  <CachedImage
                    firebasePath={`shared_${doc.doc_id}`}
                    backendUrl={sharedPreviewUrlById(doc.doc_id)}
                    alt={doc.filename || "Document"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    fallback="https://via.placeholder.com/150?text=DOC"
                  />
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  <span className="text-xs font-semibold truncate">
                    {(doc.filename || "Document").replace(/\.webp$/i, "").replace(/_/g, " ")}
                  </span>
                  <Badge variant="secondary" className="w-fit text-[0.6rem]">
                    {(doc.type || "Document").replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Main list ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Share2 size={48} className="opacity-30" />
        <p className="text-sm font-medium">Nothing shared with you yet.</p>
        <p className="text-xs">
          When someone shares a document or folder with you, it will appear here.
        </p>
      </div>
    );
  }

  // Group by owner
  const grouped = {};
  for (const item of items) {
    const key = item.owner_email || item.owner_name;
    if (!grouped[key]) grouped[key] = { ownerName: item.owner_name, ownerEmail: item.owner_email, items: [] };
    grouped[key].items.push(item);
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([key, group]) => (
        <div key={key}>
          {/* Owner header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <User size={13} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{group.ownerName || group.ownerEmail}</p>
              {group.ownerName && (
                <p className="text-[0.65rem] text-muted-foreground">{group.ownerEmail}</p>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {group.items.map((item) => {
              const isFolder = item.resource_type === "client";
              return (
                <div
                  key={item.share_id}
                  className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-foreground/20 hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all"
                  onClick={() => {
                    if (isFolder) {
                      openClientFolder(item);
                    } else {
                      onPreviewShared?.(
                        {
                          doc_id: item.resource_id,
                          firebase_path: item.firebase_path,
                          filename: item.filename || item.resource_label,
                          type: item.doc_type || "Document",
                          file_size: item.file_size || 0,
                        },
                        { ...item }
                      );
                    }
                  }}
                >
                  <div className="h-28 bg-muted flex items-center justify-center overflow-hidden">
                    {isFolder ? (
                      item.preview_path ? (
                        <CachedImage
                          firebasePath={`shared_folder_${item.share_id}`}
                          backendUrl={
                            // For folder thumbnails, we'd need the first doc's id.
                            // Fall back to folder icon if we don't have a preview doc_id.
                            "https://via.placeholder.com/150?text=Folder"
                          }
                          alt="Folder"
                          className="w-full h-full object-cover"
                          fallback="https://via.placeholder.com/150?text=Folder"
                        />
                      ) : (
                        <Folder size={36} className="text-primary/30" />
                      )
                    ) : item.firebase_path ? (
                      <CachedImage
                        firebasePath={`shared_${item.resource_id}`}
                        backendUrl={sharedPreviewUrlById(item.resource_id)}
                        alt={item.resource_label}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        fallback="https://via.placeholder.com/150?text=DOC"
                      />
                    ) : (
                      <FileImage size={36} className="text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1.5">
                    <span className="text-xs font-semibold truncate">
                      {(item.resource_label || item.resource_id).replace(/_/g, " ")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[0.6rem]">
                        {isFolder
                          ? `${item.doc_count ?? 0} files`
                          : (item.doc_type || "Doc").replace(/_/g, " ")}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[0.6rem] ${
                          item.permission === "editor"
                            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {item.permission === "editor" ? (
                          <><Download size={8} className="mr-0.5" /> Editor</>
                        ) : (
                          <><Eye size={8} className="mr-0.5" /> Viewer</>
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SharedWithMe;
