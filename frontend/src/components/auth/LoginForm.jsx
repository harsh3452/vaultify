import React, { useState } from "react";
import { Mail, Lock, Eye, EyeOff, LogIn, RefreshCw } from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";

const LoginForm = ({ onLogin, onGoRegister, onGoForgotPassword }) => {
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
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await cred.user.reload();
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
      if (code === "auth/user-not-found")
        setError("No account found with this email.");
      else if (
        code === "auth/wrong-password" ||
        code === "auth/invalid-credential"
      )
        setError("Invalid email or password. Please try again.");
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
      const cred = await signInWithEmailAndPassword(
        auth,
        unverifiedUser.email,
        unverifiedUser.password
      );
      await sendEmailVerification(cred.user, {
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
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to your Vaultify account
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
            {unverifiedUser && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resending || resent}
                  className="inline-flex items-center gap-1.5 text-primary font-medium hover:underline disabled:opacity-50"
                >
                  <RefreshCw size={13} />
                  {resending
                    ? "Sending…"
                    : resent
                      ? "✓ Sent! Check your inbox."
                      : "Resend verification email"}
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-input accent-primary"
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={onGoForgotPassword}
              className="text-primary font-medium hover:underline"
            >
              Forgot password?
            </button>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <LogIn size={16} /> Sign In
              </>
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <button
            onClick={onGoRegister}
            className="text-primary font-medium hover:underline"
          >
            Create account
          </button>
        </p>
      </div>
    </AuthLayout>
  );
};

export default LoginForm;
