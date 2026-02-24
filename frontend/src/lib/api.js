import { auth } from "./firebase";

export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const getToken = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(true);
  } catch (e) {
    console.error("[Vaultify] getToken failed:", e);
    return null;
  }
};

export const authFetch = async (url, options = {}) => {
  const token = await getToken();
  if (!token)
    console.warn("[Vaultify] authFetch: no token — user may not be signed in");

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if ((res.status === 401 || res.status === 403) && auth.currentUser) {
    console.warn(`[Vaultify] Got ${res.status}, retrying with fresh token...`);
    try {
      const freshToken = await auth.currentUser.getIdToken(true);
      return fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${freshToken}`,
        },
      });
    } catch (e) {
      console.error("[Vaultify] Token refresh failed:", e);
    }
  }

  return res;
};
