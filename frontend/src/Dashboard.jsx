import React, { useState, useEffect, useRef } from 'react';
import './Dashboard.css';
import {
    HardDrive, Home, Upload, Settings,
    Sun, Moon, User, ChevronDown, Bell, LogOut, Shield
} from 'lucide-react';

const Dashboard = ({ children, onUpload, activeView, onNavigate, onLogout, user }) => {
    const [darkMode, setDarkMode] = useState(true);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const menuRef = useRef(null);

    // Apply theme attribute to root
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    }, [darkMode]);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setUserMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className={`dash-shell ${darkMode ? 'dark' : 'light'}`}>

            {/* Animated background grid */}
            <div className="dash-grid-overlay" />

            {/* ── TOP BAR ─────────────────────────────────── */}
            <header className="dash-topbar">

                {/* LEFT: Brand + Nav + Toggle */}
                <div className="topbar-left">
                    <div className="dash-brand">
                        <HardDrive size={20} className="brand-icon" />
                        <span>VAULTIFY</span>
                    </div>

                    <div className="topbar-divider" />

                    <nav className="topbar-nav">
                        <button
                            className={`topnav-btn ${activeView === 'home' ? 'active' : ''}`}
                            onClick={() => onNavigate('home')}
                        >
                            <Home size={15} />
                            Home
                        </button>

                        <button className="topnav-btn upload-nav-btn" onClick={onUpload}>
                            <Upload size={15} />
                            Upload
                        </button>

                        <button
                            className={`topnav-btn ${activeView === 'settings' ? 'active' : ''}`}
                            onClick={() => onNavigate('settings')}
                        >
                            <Settings size={15} />
                            Settings
                        </button>
                    </nav>

                    {/* Dark / Light toggle */}
                    <button
                        className="theme-toggle"
                        onClick={() => setDarkMode(!darkMode)}
                        title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        <div className={`toggle-track ${darkMode ? '' : 'light-track'}`}>
                            <div className={`toggle-thumb ${darkMode ? '' : 'light-thumb'}`}>
                                {darkMode ? <Moon size={10} /> : <Sun size={10} />}
                            </div>
                        </div>
                        <span className="toggle-label">{darkMode ? 'Dark' : 'Light'}</span>
                    </button>
                </div>

                {/* RIGHT: Bell + User account */}
                <div className="topbar-right">
                    <button className="icon-btn notif-btn" title="Notifications">
                        <Bell size={18} />
                        <span className="notif-dot" />
                    </button>

                    <div className="user-chip" ref={menuRef} onClick={() => setUserMenuOpen(!userMenuOpen)}>
                        <div className="user-avatar-circle">
                            <User size={15} />
                        </div>
                        <div className="user-chip-info">
                            <span className="chip-name">{user?.name || 'Guest User'}</span>
                            <span className="chip-email">{user?.email || 'guest@vaultify.io'}</span>
                        </div>
                        <ChevronDown size={14} className={`chip-chevron ${userMenuOpen ? 'open' : ''}`} />

                        {/* Dropdown */}
                        {userMenuOpen && (
                            <div className="user-dropdown">
                                <div className="dropdown-header">
                                    <div className="dropdown-avatar">
                                        <User size={18} />
                                    </div>
                                    <div>
                                        <div className="dropdown-name">{user?.name || 'Guest User'}</div>
                                        <div className="dropdown-email">{user?.email || 'guest@vaultify.io'}</div>
                                    </div>
                                </div>
                                <div className="dropdown-divider" />
                                <button className="dropdown-item">
                                    <User size={14} /> Profile
                                </button>
                                <button className="dropdown-item">
                                    <Shield size={14} /> Security
                                </button>
                                <button className="dropdown-item">
                                    <Settings size={14} /> Settings
                                </button>
                                <div className="dropdown-divider" />
                                <button className="dropdown-item logout-item" onClick={onLogout}>
                                    <LogOut size={14} /> Sign Out
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* ── MAIN CONTENT ────────────────────────────── */}
            <main className="dash-main">
                {children}
            </main>
        </div>
    );
};

export default Dashboard;
