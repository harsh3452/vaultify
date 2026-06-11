import { useState } from "react";
import { auth } from "../lib/firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo
} from "firebase/auth";

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unverifiedUser, setUnverifiedUser] = useState(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const loginWithEmail = async (email, password) => {
    setLoading(true);
    setError("");
    setUnverifiedUser(null);
    setResent(false);
    
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await cred.user.reload();
      const fresh = auth.currentUser;

      if (!fresh.emailVerified) {
        await auth.signOut();
        setUnverifiedUser({ email, password });
        setError("Please verify your email before logging in.");
        return { user: null, credential: null };
      }
      return { user: fresh, credential: null };
    } catch (err) {
      handleAuthError(err);
      return { user: null, credential: null };
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    setError("");
    setUnverifiedUser(null);
    setResent(false);

    try {
      const provider = new GoogleAuthProvider();
      // Add the specific Google Drive scope
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      
      // Request offline access to get a refresh token
      // This is crucial for backend background jobs
      provider.setCustomParameters({
        prompt: 'consent',
        access_type: 'offline',
      });

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const additionalInfo = getAdditionalUserInfo(result);
      
      // Extract OAuth provider data if available
      const providerData = additionalInfo?.profile || {};
      
      // Send credential info to backend to save refresh token
      const idToken = await result.user.getIdToken();
      
      try {
        const tokenResponse = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/auth/save-gdrive-token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            // Send credential data for backend to exchange for refresh token
            body: JSON.stringify({
              access_token: credential.accessToken,
              id_token: credential.idToken,
              oauth_provider_data: providerData,
            }),
          }
        );

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json();
          console.warn("Could not save Google Drive token:", errorData);
          // Don't fail login if token save fails - just warn
        } else {
          console.log("✅ Google Drive token saved to backend");
        }
      } catch (tokenError) {
        console.warn("Error saving Google Drive token:", tokenError);
        // Don't fail login if backend call fails
      }
      
      return { user: result.user, credential };
    } catch (err) {
      console.error(err);
      handleAuthError(err);
      return { user: null, credential: null };
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
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

  const connectGoogleDrive = async () => {
    // Opens the server-side OAuth consent screen to obtain a refresh token
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/auth/gdrive-auth-url`, {
        method: 'GET',
        headers: {
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to get OAuth URL');
      const data = await res.json();
      window.open(data.url, 'gdrive_oauth', 'width=600,height=700');

      return await new Promise((resolve, reject) => {
        const listener = (ev) => {
          if (!ev.data || ev.data.type !== 'gdrive_connected') return;
          window.removeEventListener('message', listener);
          if (ev.data.status === 'success') resolve(ev.data);
          else reject(new Error('OAuth failed'));
        };
        window.addEventListener('message', listener);
        // fallback in case popup is blocked or not used
        setTimeout(() => reject(new Error('OAuth popup timeout')), 120000);
      });
    } catch (e) {
      console.warn('connectGoogleDrive failed', e);
      throw e;
    }
  };

  const handleAuthError = (err) => {
    const code = err?.code || "";
    if (code === "auth/user-not-found") setError("No account found with this email.");
    else if (code === "auth/wrong-password" || code === "auth/invalid-credential")
      setError("Invalid email or password. Please try again.");
    else if (code === "auth/invalid-email") setError("Please enter a valid email address.");
    else if (code === "auth/too-many-requests") setError("Too many attempts. Please wait a moment and try again.");
    else if (code === "auth/popup-closed-by-user") setError("Google sign-in was canceled.");
    else if (code === "auth/operation-not-allowed")
      setError("Google sign-in is disabled in Firebase. Enable the Google provider in Firebase Console > Authentication > Sign-in method.");
    else setError("Login failed. Please check your credentials.");
  };

  return {
    loginWithEmail,
    loginWithGoogle,
    connectGoogleDrive,
    resendVerification,
    loading,
    error,
    unverifiedUser,
    resending,
    resent
  };
};