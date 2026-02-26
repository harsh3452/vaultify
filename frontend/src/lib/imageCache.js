/**
 * Vaultify Image Cache
 *
 * Two-layer caching for decrypted preview images:
 *   Layer 1 – In-memory Map<string, blobURL>   (instant, same session)
 *   Layer 2 – Cache API  (persists across tabs / reloads, auto-evicts)
 *
 * Flow:
 *   1. Check in-memory map  → return immediately
 *   2. Check Cache API      → create blob URL, store in memory, return
 *   3. Fetch from backend   → store in Cache API + memory, return blob URL
 *
 * All cached data is the *decrypted* image (backend decrypts before serving).
 * The cache key is the firebase_path which uniquely identifies each document.
 */

const CACHE_NAME = "vaultify-previews-v1";

// Layer 1 – memory  (Map<firebasePath, blobURL>)
const memoryCache = new Map();

// ── helpers ──────────────────────────────────────────────────────────

function cacheKey(firebasePath) {
  // Use a synthetic URL so the Cache API is happy
  return `https://vaultify-cache/${encodeURIComponent(firebasePath)}`;
}

async function openCache() {
  if (!("caches" in window)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

// ── public API ───────────────────────────────────────────────────────

/**
 * Get a blob URL for a preview image.
 * Returns instantly from memory if available, otherwise fetches.
 *
 * @param {string} firebasePath  e.g. "uid/folder/Client_PAN_Card.webp.enc"
 * @param {string} backendUrl    full backend preview URL (with token)
 * @returns {Promise<string>}    object URL ready for <img src>
 */
export async function getCachedPreview(firebasePath, backendUrl) {
  if (!firebasePath) return "";

  // 1) Memory hit
  if (memoryCache.has(firebasePath)) {
    return memoryCache.get(firebasePath);
  }

  // 2) Cache API hit
  const cache = await openCache();
  if (cache) {
    const key = cacheKey(firebasePath);
    const cached = await cache.match(key);
    if (cached) {
      const blob = await cached.blob();
      const url = URL.createObjectURL(blob);
      memoryCache.set(firebasePath, url);
      return url;
    }
  }

  // 3) Network fetch → store in both layers
  try {
    const res = await fetch(backendUrl);
    if (!res.ok) throw new Error(`Preview fetch failed: ${res.status}`);

    const blob = await res.blob();

    // Store in Cache API (clone response because it's consumed)
    if (cache) {
      const key = cacheKey(firebasePath);
      const cacheRes = new Response(blob.slice(), {
        headers: {
          "Content-Type": blob.type || "image/webp",
          "X-Cached-At": new Date().toISOString(),
        },
      });
      cache.put(key, cacheRes).catch(() => {});
    }

    const url = URL.createObjectURL(blob);
    memoryCache.set(firebasePath, url);
    return url;
  } catch (err) {
    console.error("[ImageCache] fetch error:", err);
    return backendUrl; // fallback to direct URL
  }
}

/**
 * Invalidate a single cached preview (e.g. after re-analyze).
 */
export async function invalidatePreview(firebasePath) {
  if (!firebasePath) return;

  const oldUrl = memoryCache.get(firebasePath);
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl);
    memoryCache.delete(firebasePath);
  }

  const cache = await openCache();
  if (cache) {
    await cache.delete(cacheKey(firebasePath)).catch(() => {});
  }
}

/**
 * Invalidate ALL cached previews (e.g. on logout).
 */
export async function clearPreviewCache() {
  // Revoke all blob URLs
  for (const url of memoryCache.values()) {
    URL.revokeObjectURL(url);
  }
  memoryCache.clear();

  // Drop the whole Cache API store
  if ("caches" in window) {
    await caches.delete(CACHE_NAME).catch(() => {});
  }
}

/**
 * Get cache stats (for debugging / UI).
 */
export function getCacheStats() {
  return {
    memoryEntries: memoryCache.size,
  };
}
