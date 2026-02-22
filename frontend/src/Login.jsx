import React, { useState } from "react";
import "./Login.css";
import { Mail, Lock, HardDrive, Eye, EyeOff, LogIn } from "lucide-react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

const Login = ({ onLogin, onGoRegister, onGoForgotPassword }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const token = await userCredential.user.getIdToken();
      localStorage.setItem("vaultify_token", token);
      localStorage.setItem(
        "vaultify_user",
        JSON.stringify({
          name: userCredential.user.displayName || "User",
          email: userCredential.user.email,
          uid: userCredential.user.uid,
        }),
      );
      onLogin(userCredential.user);
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
        <div className="login-card-wrap">
          <div className="login-card">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />

            <h2 className="card-title">User Login</h2>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="input-group">
                <Mail size={16} className="input-icon" />
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <Lock size={16} className="input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              <div className="form-meta">
                <label className="remember">
                  <input type="checkbox" /> Remember me
                </label>
                <a
                  href="#"
                  className="forgot"
                  onClick={(e) => {
                    e.preventDefault();
                    onGoForgotPassword?.();
                  }}
                >
                  Forgot password?
                </a>
              </div>

              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <>
                    <LogIn size={16} /> Login
                  </>
                )}
              </button>
            </form>

            <p className="register-link">
              Don't have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onGoRegister?.();
                }}
              >
                Register
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
