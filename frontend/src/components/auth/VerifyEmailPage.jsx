import React, { useState } from "react";
import { Mail, RefreshCw, ArrowLeft, CheckCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import AuthLayout from "./AuthLayout";

const VerifyEmailPage = ({ email, password, onSuccess, onBack }) => {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  const handleContinue = async () => {
    setChecking(true);
    setError("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await cred.user.reload();
      const fresh = auth.currentUser;

      if (fresh.emailVerified) {
        onSuccess(fresh);
      } else {
        setError(
          "Email not verified yet. Please click the link in your inbox first."
        );
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
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user, {
        url: window.location.origin,
        handleCodeInApp: true,
      });
      await auth.signOut();
      setResent(true);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/too-many-requests")
        setError(
          "Too many requests. Please wait a few minutes before resending."
        );
      else setError("Failed to resend. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Back to Register
        </button>

        <div className="text-center">
          <Mail size={40} className="mx-auto text-primary mb-3" />
          <h2 className="text-2xl font-bold tracking-tight">
            Check Your Email
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            We sent a verification link to
            <br />
            <strong className="text-foreground">{email}</strong>
            <br />
            Click the link to verify your account.
          </p>
        </div>

        <div className="rounded-lg bg-primary/5 border border-primary/15 px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Check your{" "}
          <strong>spam/junk folder</strong> if you don't see it within 1–2
          minutes. The link expires in 1 hour.
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {resent && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <CheckCircle size={14} />
            Verification email resent successfully.
          </div>
        )}

        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={handleContinue}
            disabled={checking}
          >
            {checking ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <CheckCircle size={16} /> I've Verified — Continue
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            disabled={resending}
          >
            <RefreshCw size={14} />{" "}
            {resending ? "Sending…" : "Resend Verification Email"}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Wrong email?{" "}
          <button
            onClick={onBack}
            className="text-primary font-medium hover:underline"
          >
            Go back
          </button>
        </p>
      </div>
    </AuthLayout>
  );
};

export default VerifyEmailPage;
