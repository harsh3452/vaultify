import React, { useState } from "react";
import "./Auth.css";
import { Mail, ArrowLeft, Send } from "lucide-react";
import { BrandPanel } from "./Login";
import { auth } from "./firebase";
import { sendPasswordResetEmail } from "firebase/auth";

const ForgotPassword = ({ onBackToLogin }) => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      setSuccess(true);
      setEmail("");
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/user-not-found")
        setError("No account found with this email address.");
      else if (code === "auth/invalid-email")
        setError("Please enter a valid email address.");
      else if (code === "auth/too-many-requests")
        setError("Too many requests. Please try again later.");
      else setError("Failed to send reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <BrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <button className="auth-back" onClick={onBackToLogin} type="button">
            <ArrowLeft size={14} /> Back to Sign In
          </button>

          <h2 className="auth-form-title">Reset Password</h2>
          <p className="auth-form-subtitle">
            Enter your email address and we'll send you a link to reset your password.
          </p>

          {error && <div className="auth-error">{error}</div>}
          {success && (
            <div className="auth-success">
              <strong>Email sent successfully!</strong>
              <p style={{ margin: "10px 0 0 0", lineHeight: "1.6" }}>
                We've sent a password reset link to your email.
                Check your inbox (and spam folder). The link expires in 1 hour.
              </p>
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
                disabled={loading}
              />
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? <span className="spinner" /> : <><Send size={16} /> Send Reset Link</>}
            </button>
          </form>

          {!success && (
            <div className="auth-tip">
              <strong>Tip:</strong> The reset email may take 1–3 minutes. Check your{" "}
              <strong>spam/junk folder</strong> if you don't see it.
            </div>
          )}

          <p className="auth-switch">
            Remember your password?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin?.(); }}>Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
