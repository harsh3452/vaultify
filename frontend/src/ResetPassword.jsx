import React, { useState, useEffect } from "react";
import "./Auth.css";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { BrandPanel } from "./Login";
import { auth } from "./firebase";
import { confirmPasswordReset, verifyPasswordResetCode, signInWithEmailAndPassword } from "firebase/auth";

const ResetPassword = ({ onBackToLogin, onAutoLogin }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [oobCode, setOobCode] = useState(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oobCode");

    if (!code) {
      setError("Invalid or missing reset link. Please request a new one.");
      setVerifying(false);
      return;
    }

    verifyPasswordResetCode(auth, code)
      .then((emailFromCode) => {
        setOobCode(code);
        setEmail(emailFromCode);
        setVerifying(false);
      })
      .catch(() => {
        setError("This reset link is invalid or has expired. Please request a new one.");
        setVerifying(false);
      });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        if (cred.user && onAutoLogin) {
          window.history.replaceState({}, "", "/");
          onAutoLogin(cred.user);
          return;
        }
      } catch (signInErr) {
        console.warn("[Vaultify] Auto sign-in after reset failed:", signInErr);
      }
      setSuccess(true);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/expired-action-code")
        setError("This reset link has expired. Please request a new one.");
      else if (code === "auth/invalid-action-code")
        setError("This reset link is invalid or already used.");
      else if (code === "auth/weak-password")
        setError("Password is too weak. Use at least 6 characters.");
      else
        setError("Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <BrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <h2 className="auth-form-title">Set New Password</h2>

          {verifying && (
            <div style={{ textAlign: "center", padding: "2rem 0", color: "#0d9488" }}>
              <span className="spinner" style={{ display: "inline-block", borderColor: "rgba(13,148,136,0.2)", borderTopColor: "#0d9488" }} />
              <p style={{ marginTop: 12, fontSize: "0.85rem", color: "#64748b" }}>Verifying reset link…</p>
            </div>
          )}

          {!verifying && !oobCode && (
            <>
              <div className="auth-error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={16} /> {error}
              </div>
              <button className="auth-btn" onClick={onBackToLogin} style={{ marginTop: "1.5rem" }}>
                Back to Sign In
              </button>
            </>
          )}

          {success && (
            <>
              <div className="auth-success">
                <CheckCircle size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                <strong>Password updated successfully!</strong>
                <p style={{ margin: "10px 0 0 0", fontSize: "0.85rem", lineHeight: 1.5 }}>
                  You can now sign in with your new password.
                </p>
              </div>
              <button className="auth-btn" onClick={onBackToLogin} style={{ marginTop: "1rem" }}>
                Go to Sign In
              </button>
            </>
          )}

          {!verifying && oobCode && !success && (
            <>
              {email && (
                <p className="auth-form-subtitle">
                  Resetting password for <strong style={{ color: "#1e293b" }}>{email}</strong>
                </p>
              )}

              {error && <div className="auth-error">{error}</div>}

              <form onSubmit={handleSubmit} className="auth-form">
                <div className="input-group">
                  <Lock size={16} className="input-icon" />
                  <input
                    type={showPass ? "text" : "password"}
                    placeholder="New password (min. 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button type="button" className="eye-btn" onClick={() => setShowPass(!showPass)}>
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <div className="input-group">
                  <Lock size={16} className="input-icon" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button type="button" className="eye-btn" onClick={() => setShowConfirm(!showConfirm)}>
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <button type="submit" className="auth-btn" disabled={loading}>
                  {loading ? <span className="spinner" /> : <><CheckCircle size={16} /> Update Password</>}
                </button>
              </form>

              <p className="auth-switch" style={{ marginTop: "1rem" }}>
                Remember it?{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin?.(); }}>Back to Sign In</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
