import React, { useState } from "react";
import "./Auth.css";
import { Mail, RefreshCw, ArrowLeft, CheckCircle } from "lucide-react";
import { BrandPanel } from "./Login";
import { auth } from "./firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";

const VerifyEmail = ({ email, password, onSuccess, onBack }) => {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  const handleContinue = async () => {
    setChecking(true);
    setError("");
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await userCredential.user.reload();
      const fresh = auth.currentUser;

      if (fresh.emailVerified) {
        onSuccess(fresh);
      } else {
        setError("Email not verified yet. Please click the link in your inbox first.");
      }
    } catch {
      setError("Could not check verification status. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError("");
    setResent(false);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(userCredential.user, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      await auth.signOut();
      setResent(true);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/too-many-requests")
        setError("Too many requests. Please wait a few minutes before resending.");
      else
        setError("Failed to resend. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-page">
      <BrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <button onClick={onBack} className="auth-back">
            <ArrowLeft size={14} /> Back to Register
          </button>

          <div style={{ textAlign: "center", marginBottom: "1rem" }}>
            <Mail size={40} color="#0d9488" />
          </div>

          <h2 className="auth-form-title" style={{ textAlign: "center" }}>Check Your Email</h2>
          <p className="auth-form-subtitle" style={{ textAlign: "center" }}>
            We sent a verification link to<br />
            <strong style={{ color: "#1e293b" }}>{email}</strong><br />
            Click the link to verify your account.
          </p>

          <div className="auth-tip" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
            <strong>Tip:</strong> Check your <strong>spam/junk folder</strong> if
            you don't see it within 1–2 minutes. The link expires in 1 hour.
          </div>

          {error && <div className="auth-error">{error}</div>}

          {resent && (
            <div className="auth-success">
              <CheckCircle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Verification email resent successfully.
            </div>
          )}

          <button className="auth-btn" onClick={handleContinue} disabled={checking}>
            {checking ? <span className="spinner" /> : <><CheckCircle size={16} /> I've Verified — Continue</>}
          </button>

          <button
            className="auth-btn-outline"
            onClick={handleResend}
            disabled={resending}
            style={{ marginTop: "0.75rem" }}
          >
            {resending ? <><RefreshCw size={14} /> Sending…</> : <><RefreshCw size={14} /> Resend Verification Email</>}
          </button>

          <p className="auth-switch" style={{ marginTop: "1rem" }}>
            Wrong email?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Go back</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
