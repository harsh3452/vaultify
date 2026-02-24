import React, { useState } from "react";
import { Mail, ArrowLeft, Send, CheckCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";

const ForgotPasswordPage = ({ onBackToLogin }) => {
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
    <AuthLayout>
      <div className="space-y-6">
        <button
          onClick={onBackToLogin}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Back to Sign In
        </button>

        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reset Password</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your email and we'll send you a link to reset your password.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-400">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle size={14} />
              Email sent successfully!
            </div>
            <p className="mt-1.5 leading-relaxed">
              We've sent a password reset link to your email. Check your inbox
              (and spam folder). The link expires in 1 hour.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="forgotEmail">Email</Label>
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="forgotEmail"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                required
                disabled={loading}
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <Send size={16} /> Send Reset Link
              </>
            )}
          </Button>
        </form>

        {!success && (
          <div className="rounded-lg bg-primary/5 border border-primary/15 px-4 py-3 text-sm text-muted-foreground">
            <strong className="text-foreground">Tip:</strong> The reset email
            may take 1–3 minutes. Check your{" "}
            <strong>spam/junk folder</strong> if you don't see it.
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <button
            onClick={onBackToLogin}
            className="text-primary font-medium hover:underline"
          >
            Sign in
          </button>
        </p>
      </div>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
