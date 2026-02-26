import React, { useState, useEffect, useRef } from "react";
import { getCachedPreview } from "@/lib/imageCache";

// ── Hook: resolve a cached blob URL for a firebase path ──────────
export function useCachedPreview(firebasePath, backendUrl) {
  const [src, setSrc] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!firebasePath || !backendUrl) { setSrc(""); return; }

    let cancelled = false;
    setSrc("");

    getCachedPreview(firebasePath, backendUrl).then((url) => {
      if (!cancelled && mountedRef.current) setSrc(url);
    });

    return () => { cancelled = true; };
  }, [firebasePath, backendUrl]);

  return src;
}

/**
 * Drop-in replacement for <img> that uses the Vaultify image cache.
 *
 * Props:
 *   firebasePath – the document's firebase_path (used as cache key)
 *   backendUrl   – the full preview URL (with auth token)
 *   fallback     – optional fallback src if loading fails
 *   ...rest      – all other props forwarded to <img>
 */
const CachedImage = ({ firebasePath, backendUrl, fallback, alt = "", onError, ...rest }) => {
  const src = useCachedPreview(firebasePath, backendUrl);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [displaySrc, setDisplaySrc] = useState("");

  useEffect(() => {
    if (src) {
      setDisplaySrc(src);
      setLoaded(false);
      setErrored(false);
    }
  }, [src]);

  const handleError = (e) => {
    if (!errored && fallback) {
      setErrored(true);
      setDisplaySrc(fallback);
    }
    onError?.(e);
  };

  if (!displaySrc) {
    // Skeleton placeholder while loading from cache / network
    return (
      <div
        className={rest.className || ""}
        style={{ ...rest.style, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div className="w-6 h-6 border-2 border-muted-foreground/20 border-t-muted-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <img
      {...rest}
      src={displaySrc}
      alt={alt}
      onError={handleError}
      onLoad={() => setLoaded(true)}
      style={{
        ...rest.style,
        opacity: loaded ? 1 : 0,
        transition: "opacity 0.2s ease-in",
      }}
    />
  );
};

export default CachedImage;
