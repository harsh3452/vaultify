import React, { useState } from "react";
import "./Auth.css";
import { Mail, Lock, Eye, EyeOff, LogIn, RefreshCw, HardDrive, FileCheck, Brain, Shield, FolderOpen } from "lucide-react";
import { auth } from "./firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";

const BrandPanel = () => (
  <div className="auth-brand-panel">
    <div className="brand-logo">
      <HardDrive size={22} />
      <span>VAULTIFY</span>
    </div>
    <h1 className="brand-headline">
      AI-Powered Document Sorting for Professionals
    </h1>
    <p className="brand-tagline">
      Upload client documents and let AI classify, sort, and organize them
      instantly. Built for LIC agents, CAs, and financial professionals.
    </p>
    <ul className="brand-features">
      <li><Brain size={18} /> AI classifies documents for you</li>
      <li><FolderOpen size={18} /> Auto-organizes by client name and document type</li>
      <li><Shield size={18} /> Secure cloud storage with Firebase</li>
      <li><FileCheck size={18} /> Download as JPG or PDF anytime</li>
    </ul>
  </div>
);

const Login = ({ onLogin, onGoRegister, onGoForgotPassword }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unverifiedUser, setUnverifiedUser] = useState(null);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setUnverifiedUser(null);
    setResent(false);
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await user.reload();
      const fresh = auth.currentUser;

      if (!fresh.emailVerified) {
        await auth.signOut();
        setUnverifiedUser({ email, password });
        setError("Please verify your email before logging in.");
        return;
      }

      onLogin(fresh);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/user-not-found" || code === "auth/invalid-credential")
        setError("No account found with this email.");
      else if (code === "auth/wrong-password")
        setError("Incorrect password. Please try again.");
      else if (code === "auth/invalid-email")
        setError("Please enter a valid email address.");
      else if (code === "auth/too-many-requests")
        setError("Too many attempts. Please wait a moment and try again.");
      else setError("Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedUser) return;
    setResending(true);
    setResent(false);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, unverifiedUser.email, unverifiedUser.password);
      await sendEmailVerification(userCredential.user, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      await auth.signOut();
      setResent(true);
    } catch {
      setError("Failed to resend verification email. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-page">
      <BrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <h2 className="auth-form-title">Welcome back</h2>
          <p className="auth-form-subtitle">Sign in to your Vaultify account</p>

          {error && (
            <div className="auth-error">
              {error}
              {unverifiedUser && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resending || resent}
                    style={{
                      background: "none", border: "none",
                      color: "#0d9488", cursor: "pointer",
                      fontSize: "0.82rem", padding: 0,
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <RefreshCw size={13} />
                    {resending ? "Sending…" : resent ? "✓ Sent! Check your inbox." : "Resend verification email"}
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="input-group">
              <Mail size={16} className="input-icon" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="input-group">
              <Lock size={16} className="input-icon" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="eye-btn" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <div className="form-meta">
              <label className="remember"><input type="checkbox" /> Remember me</label>
              <a href="#" className="forgot" onClick={(e) => { e.preventDefault(); onGoForgotPassword?.(); }}>
                Forgot password?
              </a>
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? <span className="spinner" /> : <><LogIn size={16} /> Sign In</>}
            </button>
          </form>

          <p className="auth-switch">
            Don't have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onGoRegister?.(); }}>Create account</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export { BrandPanel };
export default Login;
