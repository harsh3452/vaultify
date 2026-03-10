import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserPlus,
  Crown,
  Pencil,
  Eye,
  Trash2,
  Mail,
  X,
  ChevronDown,
  Clock,
  Shield,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch, API } from "@/lib/api";

const ROLE_BADGES = {
  admin:  { label: "Admin",  icon: Crown,  className: "bg-primary/10 text-primary border-primary/30" },
  editor: { label: "Editor", icon: Pencil, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  viewer: { label: "Viewer", icon: Eye,    className: "bg-muted text-muted-foreground border-border" },
};

const MembersPanel = ({ userRole }) => {
  const [members, setMembers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [myInvites, setMyInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);

  const isAdmin = userRole === "admin";

  const fetchMembers = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await authFetch(`${API}/auth/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setPendingInvites(data.pending_invites || []);
      }
    } catch {}
    setLoading(false);
  }, [isAdmin]);

  const fetchMyInvites = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/auth/members/invite/pending`);
      if (res.ok) {
        const data = await res.json();
        setMyInvites(data.invites || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchMembers();
    fetchMyInvites();
  }, [fetchMembers, fetchMyInvites]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    if (!inviteEmail.trim()) {
      setInviteError("Email is required");
      return;
    }
    try {
      const res = await authFetch(`${API}/auth/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteSuccess(data.message);
        setInviteEmail("");
        fetchMembers();
      } else {
        setInviteError(data.error || "Failed to send invite");
      }
    } catch {
      setInviteError("Network error");
    }
  };

  const handleChangeRole = async (uid, newRole) => {
    try {
      await authFetch(`${API}/auth/members/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, role: newRole }),
      });
      fetchMembers();
    } catch {}
  };

  const handleRemove = async (uid) => {
    if (!confirm("Remove this member? They will lose access to the vault.")) return;
    try {
      await authFetch(`${API}/auth/members/remove?uid=${encodeURIComponent(uid)}`, {
        method: "DELETE",
      });
      fetchMembers();
    } catch {}
  };

  const handleCancelInvite = async (email) => {
    try {
      await authFetch(`${API}/auth/members/invite/cancel?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      fetchMembers();
    } catch {}
  };

  const handleAcceptInvite = async () => {
    try {
      const res = await authFetch(`${API}/auth/members/invite/accept`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setMyInvites([]);
        // Reload to pick up new role
        window.location.reload();
      } else {
        alert(data.error || "Failed to accept invite");
      }
    } catch {}
  };

  const handleRejectInvite = async () => {
    try {
      await authFetch(`${API}/auth/members/invite/reject`, {
        method: "POST",
      });
      fetchMyInvites();
    } catch {}
  };

  const handleLeave = async () => {
    if (!confirm("Leave this vault? You will lose access to all documents.")) return;
    try {
      const res = await authFetch(`${API}/auth/members/leave`, {
        method: "POST",
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {}
  };

  // ── Non-admin: show pending invite or leave button ──
  if (!isAdmin) {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users size={20} /> Vault Membership
        </h2>

        {/* Pending invites for this user */}
        {myInvites.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 mb-4">
            <p className="text-sm font-semibold mb-2">Pending Invite</p>
            {myInvites.map((inv, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 mb-2">
                <Mail size={16} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{inv.owner_name || inv.owner_email}</p>
                  <p className="text-xs text-muted-foreground">
                    invited you as <span className="font-semibold capitalize">{inv.role}</span>
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs" onClick={handleAcceptInvite}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleRejectInvite}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Current membership */}
        {userRole && userRole !== "admin" && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-3">
              You are a <span className="font-semibold capitalize">{userRole}</span> in this vault.
            </p>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleLeave}>
              <LogOut size={14} /> Leave Vault
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Admin view ──
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users size={20} /> Team Members
        </h2>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={() => { setShowInviteForm(!showInviteForm); setInviteError(""); setInviteSuccess(""); }}
        >
          <UserPlus size={14} /> Invite Member
        </Button>
      </div>

      {/* Invite form */}
      {showInviteForm && (
        <form onSubmit={handleInvite} className="rounded-xl border border-border bg-card p-4 mb-5 space-y-3">
          <p className="text-sm font-semibold">Send Invite</p>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="team@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button type="submit" size="sm" className="h-9">
              <Mail size={14} /> Send
            </Button>
          </div>
          {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
          {inviteSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{inviteSuccess}</p>}
          <div className="text-[0.65rem] text-muted-foreground space-y-0.5">
            <p><span className="font-semibold">Viewer</span> — Can preview documents only (no download)</p>
            <p><span className="font-semibold">Editor</span> — Can upload, review, edit, reanalyze, and download</p>
          </div>
        </form>
      )}

      {/* Admin (you) */}
      <div className="rounded-xl border border-border bg-card mb-3 overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Account</span>
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
            <Crown size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">You (Admin)</p>
            <p className="text-xs text-muted-foreground">Full access to all vault features</p>
          </div>
          <Badge variant="outline" className={ROLE_BADGES.admin.className}>
            Admin
          </Badge>
        </div>
      </div>

      {/* Active members */}
      {members.length > 0 && (
        <div className="rounded-xl border border-border bg-card mb-3 overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Members ({members.length})
            </span>
          </div>
          {members.map((m, i) => {
            const badge = ROLE_BADGES[m.role] || ROLE_BADGES.viewer;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 ${i < members.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-sm font-bold shrink-0">
                  {(m.name || m.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{m.name || m.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>
                <select
                  value={m.role}
                  onChange={(e) => handleChangeRole(m.uid, e.target.value)}
                  className="h-7 px-2 rounded-md border border-border bg-muted/50 text-xs text-foreground focus:outline-none"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(m.uid)}
                  title="Remove member"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Pending Invites ({pendingInvites.length})
            </span>
          </div>
          {pendingInvites.map((inv, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 ${i < pendingInvites.length - 1 ? "border-b border-border" : ""}`}
            >
              <Clock size={16} className="text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{inv.email}</p>
                <p className="text-xs text-muted-foreground">
                  Invited as <span className="capitalize">{inv.role}</span>
                  {inv.created_at ? ` · ${inv.created_at}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleCancelInvite(inv.email)}
                title="Cancel invite"
              >
                <X size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && pendingInvites.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Users size={48} className="mx-auto opacity-30 mb-3" />
          <p className="text-sm font-medium">No team members yet</p>
          <p className="text-xs mt-1">Invite editors or viewers to collaborate on your vault.</p>
        </div>
      )}
    </div>
  );
};

export default MembersPanel;
