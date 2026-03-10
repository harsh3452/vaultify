import React, { useState, useEffect } from "react";
import {
  Home,
  Clock,
  AlertCircle,
  Star,
  Trash2,
  Search,
  Sun,
  Moon,
  LogOut,
  User,
  Shield,
  Settings,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

const ALL_NAV_ITEMS = [
  { key: "home", label: "Home", icon: Home },
  { key: "recent", label: "Recent", icon: Clock },
  { key: "shared", label: "Shared with me", icon: Share2 },
  { key: "review", label: "Manual Review", icon: AlertCircle },
  { key: "starred", label: "Starred", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 },
];

/* ── Sidebar Content (reused for desktop + mobile sheet) ── */
const SidebarContent = ({ activeView, onNavigate, collapsed }) => {
  const navItems = ALL_NAV_ITEMS;
  return (
    <nav className="flex flex-col gap-1 px-2">
      {navItems.map(({ key, label, icon: Icon }) => {
      const active = activeView === key;
      return (
        <button
          key={key}
          onClick={() => onNavigate(key)}
          title={collapsed ? label : undefined}
          className={`
            group flex items-center gap-3 rounded-xl text-sm font-medium
            transition-all duration-200 outline-none
            ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"}
            ${
              active
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }
          `}
        >
          <Icon size={18} className="shrink-0" />
          {!collapsed && <span className="truncate">{label}</span>}
        </button>
      );
    })}
  </nav>
  );
};

const DashboardShell = ({
  children,
  activeView,
  onNavigate,
  onLogoClick,
  onLogout,
  user,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "GU";

  const firstName = user?.name ? user.name.split(" ")[0] : "Guest";

  const handleSearchKey = (e) => {
    if (e.key === "Enter" && onSearchSubmit) onSearchSubmit();
  };

  return (
    <div className="flex h-screen bg-background transition-colors overflow-hidden">
      {/* ─── Desktop Sidebar ────────────────────────── */}
      <aside
        className={`
          hidden md:flex flex-col border-r border-border bg-card/60 backdrop-blur-xl
          transition-[width] duration-300 ease-in-out shrink-0
          ${collapsed ? "w-[64px]" : "w-[240px]"}
        `}
      >
        {/* Brand */}
        <button
          onClick={() => onLogoClick?.()}
          className={`flex items-center h-[60px] border-b border-border shrink-0 cursor-pointer hover:bg-muted/50 transition-colors ${collapsed ? "justify-center px-2" : "px-4 gap-2.5"}`}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-primary-foreground shrink-0">
            <HardDrive size={16} />
          </div>
          {!collapsed && (
            <span className="font-extrabold tracking-[2px] text-sm text-foreground">
              VAULTIFY
            </span>
          )}
        </button>

        {/* Nav */}
        <ScrollArea className="flex-1 py-3">
          <SidebarContent
            activeView={activeView}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        </ScrollArea>

        {/* Dark mode + Collapse toggle */}
        <div className="border-t border-border p-2 flex flex-col gap-1">
          <button
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? "Light mode" : "Dark mode"}
            className={`flex items-center gap-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all px-3 py-2.5 ${collapsed ? "justify-center px-2" : ""}`}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {!collapsed && (
              <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>
            )}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center gap-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all px-3 py-2.5 ${collapsed ? "justify-center px-2" : ""}`}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ─── Main Area ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top Bar ─────────────────────────────── */}
        <header className="sticky top-0 z-40 h-[60px] flex items-center gap-3 px-4 md:px-6 bg-card/80 backdrop-blur-xl border-b border-border shrink-0">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-9 w-9"
              >
                <Menu size={20} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <button
                onClick={() => { onLogoClick?.(); setMobileOpen(false); }}
                className="flex items-center h-[60px] px-4 gap-2.5 border-b border-border w-full cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-primary-foreground">
                  <HardDrive size={16} />
                </div>
                <span className="font-extrabold tracking-[2px] text-sm">
                  VAULTIFY
                </span>
              </button>
              <ScrollArea className="flex-1 py-3">
                <SidebarContent
                  activeView={activeView}
                  onNavigate={(view) => {
                    onNavigate(view);
                    setMobileOpen(false);
                  }}
                  collapsed={false}
                />
              </ScrollArea>
            </SheetContent>
          </Sheet>

          {/* Search bar */}
          <div className="flex-1 max-w-xl mx-auto">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search documents, clients..."
                value={searchQuery || ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
                onKeyDown={handleSearchKey}
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-muted/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-card transition"
              />
            </div>
          </div>

          {/* Right: avatar */}
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-xl hover:bg-muted px-2 py-1.5 transition-colors cursor-pointer outline-none">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-teal-400 text-primary-foreground text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm font-medium text-foreground">
                    {firstName}
                  </span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <div className="flex items-center gap-3 px-3 py-2.5 bg-primary/5">
                  <Avatar className="h-9 w-9 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-teal-400 text-primary-foreground text-sm font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {user?.name || "Guest User"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email || "guest@vaultify.io"}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User size={14} /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Shield size={14} /> Security
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings size={14} /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut size={14} /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ── Content ─────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
};

export default DashboardShell;
