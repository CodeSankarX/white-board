import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function normalizeBase(path) {
  if (!path || path === "/") return "/";
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * Production-only CSP: blocks most XSS (no arbitrary remote scripts). Omitted in dev so Vite HMR works.
 * frame-ancestors is ignored in meta CSP — set it as an HTTP header on your host if supported.
 */
function productionCspPlugin() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    [
      "script-src",
      "'self'",
      "https://accounts.google.com",
      "https://apis.google.com",
      "https://www.gstatic.com",
      "https://ssl.gstatic.com",
    ].join(" "),
    [
      "style-src",
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ].join(" "),
    [
      "font-src",
      "'self'",
      "https://fonts.gstatic.com",
      "https://esm.sh",
      "data:",
    ].join(" "),
    ["img-src", "'self'", "data:", "blob:", "https:"].join(" "),
    [
      "connect-src",
      "'self'",
      "https://www.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://accounts.google.com",
      "https://content.googleapis.com",
      "https://apis.google.com",
      "https://api.allorigins.win",
      "https://api.codetabs.com",
      "https://corsproxy.io",
    ].join(" "),
    ["worker-src", "'self'", "blob:"].join(" "),
    [
      "frame-src",
      "https://accounts.google.com",
      "https://content.googleapis.com",
    ].join(" "),
    "upgrade-insecure-requests",
  ];
  const policy = directives.join("; ");
  return {
    name: "inject-production-csp",
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;
      const meta = `    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />\n`;
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n${meta}`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    base: normalizeBase(env.VITE_BASE_PATH || "/"),
  };
});
