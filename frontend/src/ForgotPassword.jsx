import React, { useState } from "react";
import "./ForgotPassword.css";
import { Mail, HardDrive, ArrowLeft, Send } from "lucide-react";
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
        url: window.location.origin + "/login",
        handleCodeInApp: false,
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
    <div className="forgot-password-page">
      <div className="grid-overlay" />

      <span className="binary b1">10110010</span>
      <span className="binary b2">01001101</span>
      <span className="binary b3">11010010</span>
      <span className="binary b4">00110101</span>
      <span className="binary b5">10101010</span>

      <nav className="forgot-nav">
        <div className="nav-brand">
          <HardDrive size={22} className="nav-icon" />
          <span>VAULTIFY</span>
        </div>
        <div className="nav-links">
          <a href="#">Home</a>
          <a href="#">Features</a>
          <a href="#">Clients</a>
          <a href="#">Solutions</a>
        </div>
      </nav>

      <div className="forgot-body">
        <div className="forgot-card-wrap">
          <div className="forgot-card">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />

            <button className="back-btn" onClick={onBackToLogin} type="button">
              <ArrowLeft size={16} />
              Back to Login
            </button>

            <h2 className="card-title">Reset Password</h2>
            <p className="card-subtitle">
              Enter your email address and we'll send you a link to reset your
              password.
            </p>

            {error && <div className="auth-error">{error}</div>}
            {success && (
              <div className="auth-success">
                <strong>✓ Email sent successfully!</strong>
                <p style={{ margin: "12px 0 0 0", lineHeight: "1.6" }}>
                  We've sent a password reset link to your email address.
                </p>
                <p style={{ margin: "8px 0 0 0", lineHeight: "1.6" }}>
                  <strong>📧 Check your inbox</strong> (and spam/junk folder)
                  <br />
                  <small style={{ color: "rgba(160, 245, 208, 0.8)" }}>
                    If you don't see the email within 2-3 minutes, check your
                    spam folder. The link expires in 1 hour.
                  </small>
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="forgot-form">
              <div className="input-group">
                <Mail size={16} className="input-icon" />
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <button type="submit" className="reset-btn" disabled={loading}>
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <>
                    <Send size={16} /> Send Reset Link
                  </>
                )}
              </button>
            </form>

            {!success && (
              <div
                style={{
                  background: "rgba(100, 150, 255, 0.08)",
                  border: "1px solid rgba(100, 150, 255, 0.2)",
                  borderRadius: "4px",
                  padding: "12px 14px",
                  marginTop: "16px",
                  fontSize: "0.8rem",
                  color: "rgba(180, 200, 230, 0.9)",
                  lineHeight: "1.5",
                }}
              >
                <strong style={{ color: "#b4c7ff" }}>💡 Tip:</strong> The reset
                email may take 1-3 minutes to arrive. Check your{" "}
                <strong>spam/junk folder</strong> if you don't see it in your
                inbox.
              </div>
            )}

            <p className="login-link">
              Remember your password?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onBackToLogin?.();
                }}
              >
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
