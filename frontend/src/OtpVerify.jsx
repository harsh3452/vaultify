import React, { useState, useRef, useEffect } from "react";
import "./Login.css";
import "./OtpVerify.css";
import {
  HardDrive,
  Mail,
  CheckCircle,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { auth } from "./firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";

const RESEND_COOLDOWN = 60; // seconds

const OtpVerify = ({
  email,
  password,
  fullName,
  initialDevNote = "",
  onSuccess,
  onBack,
}) => {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const [devNote, setDevNote] = useState(initialDevNote); // shown when email delivery falls back to console
  const inputRefs = useRef([]);

  // Start cooldown timer on mount (OTP was already sent by Register)
  useEffect(() => {
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Focus first box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index, value) => {
    if (!/^\d*$/.test(value)) return; // digits only
    const next = [...otp];
    next[index] = value.slice(-1); // keep last digit
    setOtp(next);
    setError("");

    // Auto-advance
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (next.every((d) => d !== "") && next.join("").length === 6) {
      submitOtp(next.join(""));
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0)
      inputRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5)
      inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = [...otp];
    for (let i = 0; i < 6; i++) next[i] = pasted[i] || "";
    setOtp(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6) submitOtp(pasted);
  };

  const submitOtp = async (code) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("http://localhost:8000/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed.");
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }

      // OTP valid — now create the Firebase account
      setVerified(true);
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await updateProfile(userCredential.user, { displayName: fullName });

      setTimeout(() => onSuccess(), 900);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/email-already-in-use")
        setError("An account with this email already exists. Please log in.");
      else setError(err.message || "Something went wrong. Please try again.");
      setVerified(false);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyClick = (e) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    submitOtp(code);
  };

  const handleResend = async () => {
    setResending(true);
    setError("");
    try {
      const res = await fetch("http://localhost:8000/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const d = await res.json();
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        setCooldown(RESEND_COOLDOWN);
        if (d.dev_note) setDevNote(d.dev_note);
      } else {
        const d = await res.json();
        setError(d.error || "Failed to resend OTP.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="login-page">
      <div className="grid-overlay" />

      <span className="binary b1">10110010</span>
      <span className="binary b2">01001101</span>
      <span className="binary b3">11010010</span>
      <span className="binary b4">00110101</span>
      <span className="binary b5">10101010</span>

      <nav className="login-nav">
        <div className="nav-brand">
          <HardDrive size={22} className="nav-icon" />
          <span>VAULTIFY</span>
        </div>
      </nav>

      <div className="login-body">
        <div className="login-card-wrap" style={{ width: 420 }}>
          <div className="login-card">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />

            {/* Back button */}
            <button
              onClick={onBack}
              style={{
                background: "none",
                border: "none",
                color: "rgba(0,230,200,0.6)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "0.8rem",
                padding: 0,
                marginBottom: "1.25rem",
              }}
            >
              <ArrowLeft size={14} /> Back to Register
            </button>

            {/* Icon */}
            <div className="otp-icon-wrap">
              {verified ? (
                <CheckCircle size={30} className="otp-success-icon" />
              ) : (
                <Mail size={30} color="#00e6c8" />
              )}
            </div>

            <h2 className="card-title" style={{ textAlign: "center" }}>
              {verified ? "Email Verified!" : "Verify Your Email"}
            </h2>

            {!verified && (
              <>
                <p className="otp-hint">
                  We sent a 6-digit code to
                  <br />
                  <strong>{email}</strong>.<br />
                  Enter it below to confirm your email.
                </p>
                <div
                  style={{
                    background: "rgba(100, 150, 255, 0.08)",
                    border: "1px solid rgba(100, 150, 255, 0.2)",
                    borderRadius: "6px",
                    padding: "10px 12px",
                    marginBottom: "1rem",
                    fontSize: "0.78rem",
                    color: "rgba(180, 200, 230, 0.9)",
                    lineHeight: "1.5",
                  }}
                >
                  <strong style={{ color: "#b4c7ff" }}>💡 Tip:</strong> Check
                  your <strong>spam/junk folder</strong> if you don't see the
                  email within 1-2 minutes.
                </div>
                {devNote && (
                  <div
                    style={{
                      background: "rgba(251,191,36,0.08)",
                      border: "1px solid rgba(251,191,36,0.3)",
                      borderRadius: 8,
                      padding: "10px 14px",
                      color: "#fbbf24",
                      fontSize: "0.78rem",
                      lineHeight: 1.5,
                      marginBottom: "1rem",
                    }}
                  >
                    ⚠️ Email delivery unavailable — check the{" "}
                    <strong>server terminal</strong> for your OTP code.
                  </div>
                )}
              </>
            )}

            {verified ? (
              <p
                className="otp-hint"
                style={{ color: "#22c55e", textAlign: "center" }}
              >
                Creating your account…
              </p>
            ) : (
              <form onSubmit={handleVerifyClick}>
                {error && <div className="auth-error">{error}</div>}

                {/* 6-box OTP input */}
                <div className="otp-boxes" onPaste={handlePaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => (inputRefs.current[i] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      className={`otp-box ${digit ? "filled" : ""}`}
                      disabled={loading}
                      autoComplete="off"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  className="login-btn"
                  disabled={loading || otp.join("").length < 6}
                >
                  {loading ? (
                    <span className="spinner" />
                  ) : (
                    <>
                      <CheckCircle size={16} /> Verify &amp; Create Account
                    </>
                  )}
                </button>

                {/* Resend */}
                <div className="otp-resend">
                  {cooldown > 0 ? (
                    <>
                      Resend code in{" "}
                      <span className="otp-timer">{cooldown}s</span>
                    </>
                  ) : (
                    <>
                      Didn't receive it?{" "}
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resending}
                      >
                        {resending ? (
                          <>
                            <RefreshCw size={12} /> Sending…
                          </>
                        ) : (
                          "Resend OTP"
                        )}
                      </button>
                    </>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OtpVerify;
