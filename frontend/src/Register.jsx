import React, { useState } from "react";
import "./Auth.css";
import { Mail, Lock, User, Eye, EyeOff, UserPlus } from "lucide-react";
import { BrandPanel } from "./Login";
import { auth } from "./firebase";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut,
} from "firebase/auth";

const Register = ({ onGoLogin, onGoVerify }) => {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.fullName.trim()) return setError("Full name is required.");
    if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await updateProfile(userCredential.user, { displayName: form.fullName.trim() });
      await sendEmailVerification(userCredential.user, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      await signOut(auth);
      onGoVerify({ email: form.email, password: form.password });
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/email-already-in-use")
        setError("An account with this email already exists. Please sign in.");
      else if (code === "auth/invalid-email")
        setError("Please enter a valid email address.");
      else if (code === "auth/weak-password")
        setError("Password is too weak. Use at least 6 characters.");
      else setError("Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <BrandPanel />

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <h2 className="auth-form-title">Create account</h2>
          <p className="auth-form-subtitle">Get started with Vaultify in seconds</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="input-group">
              <User size={16} className="input-icon" />
              <input type="text" placeholder="Full name" value={form.fullName} onChange={set("fullName")} required />
            </div>

            <div className="input-group">
              <Mail size={16} className="input-icon" />
              <input type="email" placeholder="Email address" value={form.email} onChange={set("email")} required />
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
              <button type="button" className="eye-btn" onClick={() => setShowPass(!showPass)}>
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
              <button type="button" className="eye-btn" onClick={() => setShowConfirm(!showConfirm)}>
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? <span className="spinner" /> : <><UserPlus size={16} /> Create Account</>}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onGoLogin(); }}>Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
