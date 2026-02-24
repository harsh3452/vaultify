import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader, CheckCircle, AlertCircle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";
import { Button } from "@/components/ui/button";
import AuthLayout from "./AuthLayout";

const VerifyActionPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("verifying");
  const [error, setError] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("oobCode");
    if (!code) {
      setError("Invalid or missing verification link.");
      setStatus("error");
      return;
    }

    applyActionCode(auth, code)
      .then(() => {
        setStatus("success");
        window.history.replaceState({}, "", "/");
      })
      .catch((err) => {
        const c = err?.code || "";
        if (c === "auth/invalid-action-code")
          setError("This link is invalid or has already been used.");
        else if (c === "auth/expired-action-code")
          setError(
            "This link has expired. Please request a new verification email."
          );
        else setError("Verification failed. Please try again.");
        setStatus("error");
      });
  }, []);

  return (
    <AuthLayout>
      <div className="text-center space-y-4">
        {status === "verifying" && (
          <>
            <Loader
              size={32}
              className="animate-spin text-primary mx-auto"
            />
            <p className="text-sm text-muted-foreground">
              Verifying your email...
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle size={48} className="text-primary mx-auto" />
            <h2 className="text-2xl font-bold tracking-tight">
              Email Verified!
            </h2>
            <p className="text-sm text-muted-foreground">
              Your email has been verified successfully.
            </p>
            <div className="rounded-lg bg-primary/5 border border-primary/15 px-4 py-3 text-sm text-muted-foreground text-left">
              <strong className="text-foreground">
                Go back to your original tab
              </strong>{" "}
              and click{" "}
              <strong className="text-foreground">
                "I've Verified — Continue"
              </strong>{" "}
              to log in directly. You can close this tab.
            </div>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Or Sign In Here
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle size={48} className="text-destructive mx-auto" />
            <h2 className="text-2xl font-bold tracking-tight">
              Verification Failed
            </h2>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Back to Sign In
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
};

export default VerifyActionPage;
