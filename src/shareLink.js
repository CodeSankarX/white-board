/**
 * Public view links use the URL hash so static hosts (e.g. GitHub Pages) work without SPA fallbacks.
 * Example: https://you.github.io/repo/#view=DRIVE_FILE_ID
 */

export function parsePublicViewFileIdFromHash() {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith("view=")) {
    const part = raw.slice(5).split("&")[0];
    const id = decodeURIComponent(part.trim());
    return id || null;
  }
  const m = raw.match(/^\/view\/([^/?&#]+)/);
  if (m) return decodeURIComponent(m[1]) || null;
  return null;
}

/** Full URL to open this diagram on this site in read-only public mode (no Google sign-in). */
export function buildPublicSketchShareUrl(fileId) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const root = `${window.location.origin}${base}`;
  return `${root}/#view=${encodeURIComponent(fileId)}`;
}
