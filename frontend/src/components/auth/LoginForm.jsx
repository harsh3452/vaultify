import React, { useState } from "react";
import { Mail, Lock, Eye, EyeOff, LogIn, RefreshCw, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "./AuthLayout";
import { useAuth } from "../../hooks/useAuth";

const LoginForm = ({ onLogin, onGoRegister, onGoForgotPassword }) => {
  const { 
    loginWithEmail, 
    loginWithGoogle, 
    connectGoogleDrive,
    resendVerification, 
    loading, 
    error, 
    unverifiedUser, 
    resending, 
    resent 
  } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveNotice, setDriveNotice] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { user } = await loginWithEmail(email, password);
    if (user) {
      onLogin(user);
    }
  };

  const handleGoogleLogin = async () => {
    setDriveNotice("");
    const { user } = await loginWithGoogle();
    if (user) {
      try {
        setDriveConnecting(true);
        await connectGoogleDrive();
        setDriveNotice("Google Drive connected.");
      } catch {
        setDriveNotice("Signed in, but Drive connect failed. You can retry in Settings.");
      } finally {
        setDriveConnecting(false);
      }
      onLogin(user);
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
                  onClick={resendVerification}
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
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email" type="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="pl-9" required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password" type={showPassword ? "text" : "password"} placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-10" required
              />
              <button
                type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-muted-foreground cursor-pointer">
              <input type="checkbox" className="rounded border-input accent-primary" />
              Remember me
            </label>
            <button type="button" onClick={onGoForgotPassword} className="text-primary font-medium hover:underline">
              Forgot password?
            </button>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <><LogIn size={16} /> Sign In</>}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading || driveConnecting}>
          <HardDrive size={16} className="mr-2 text-blue-500" />
          {driveConnecting ? "Connecting Drive..." : "Sign in with Google Drive"}
        </Button>

        {driveNotice && (
          <p className="text-center text-xs text-muted-foreground">{driveNotice}</p>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <button onClick={onGoRegister} className="text-primary font-medium hover:underline">
            Create account
          </button>
        </p>
      </div>
    </AuthLayout>
  );
};

export default LoginForm;
