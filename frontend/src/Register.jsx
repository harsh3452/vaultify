import React, { useState } from "react";
import "./Login.css";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  UserPlus,
  HardDrive,
} from "lucide-react";

const Register = ({ onGoLogin, onGoOtp }) => {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.fullName.trim()) return setError("Full name is required.");
    if (form.password.length < 6)
      return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm)
      return setError("Passwords do not match.");

    setLoading(true);

    try {
      // Step 1: send OTP to verify the email is real
      const res = await fetch("http://localhost:8000/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send OTP. Please try again.");
        return;
      }
      // Step 2: navigate to OTP page, passing registration details + any dev note
      onGoOtp({
        email: form.email,
        password: form.password,
        fullName: form.fullName.trim(),
        devNote: data.dev_note || "",
      });
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
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
        <div className="nav-links">
          <a href="#">Home</a>
          <a href="#">Features</a>
          <a href="#">Clients</a>
          <a href="#">Solutions</a>
        </div>
      </nav>

      <div className="login-body">
        <div className="login-card-wrap" style={{ width: 440 }}>
          <div className="login-card">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />

            <h2 className="card-title">Create Account</h2>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="input-group">
                <User size={16} className="input-icon" />
                <input
                  type="text"
                  placeholder="Full name"
                  value={form.fullName}
                  onChange={set("fullName")}
                  required
                />
              </div>

              <div className="input-group">
                <Mail size={16} className="input-icon" />
                <input
                  type="email"
                  placeholder="Email address"
                  value={form.email}
                  onChange={set("email")}
                  required
                />
              </div>

              <div className="input-group">
                <Lock size={16} className="input-icon" />
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Password (min. 6 characters)"
                  value={form.password}
                  onChange={set("password")}
                  required
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowPass(!showPass)}
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              <div className="input-group">
                <Lock size={16} className="input-icon" />
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Confirm password"
                  value={form.confirm}
                  onChange={set("confirm")}
                  required
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              <button
                type="submit"
                className="login-btn"
                disabled={loading}
                style={{ marginTop: "0.5rem" }}
              >
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <>
                    <UserPlus size={16} /> Create Account
                  </>
                )}
              </button>
            </form>

            <p className="register-link">
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onGoLogin();
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

export default Register;
