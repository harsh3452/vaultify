import React, { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  confirmPasswordReset,
  verifyPasswordResetCode,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";

const ResetPasswordPage = ({ onBackToLogin, onAutoLogin }) => {
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
        setError(
          "This reset link is invalid or has expired. Please request a new one."
        );
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
        console.warn(
          "[Vaultify] Auto sign-in after reset failed:",
          signInErr
        );
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
      else setError("Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Set New Password</h2>

        {/* Verifying spinner */}
        {verifying && (
          <div className="text-center py-8">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 text-sm text-muted-foreground">
              Verifying reset link…
            </p>
          </div>
        )}

        {/* Invalid link */}
        {!verifying && !oobCode && (
          <>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
            <Button className="w-full" onClick={onBackToLogin}>
              Back to Sign In
            </Button>
          </>
        )}

        {/* Success */}
        {success && (
          <>
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle size={16} />
                Password updated successfully!
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">
                You can now sign in with your new password.
              </p>
            </div>
            <Button className="w-full" onClick={onBackToLogin}>
              Go to Sign In
            </Button>
          </>
        )}

        {/* Reset form */}
        {!verifying && oobCode && !success && (
          <>
            {email && (
              <p className="text-sm text-muted-foreground">
                Resetting password for{" "}
                <strong className="text-foreground">{email}</strong>
              </p>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPass">New password</Label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="newPass"
                    type={showPass ? "text" : "password"}
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPass">Confirm new password</Label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="confirmNewPass"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    <CheckCircle size={16} /> Update Password
                  </>
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Remember it?{" "}
              <button
                onClick={onBackToLogin}
                className="text-primary font-medium hover:underline"
              >
                Back to Sign In
              </button>
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
};

export default ResetPasswordPage;
