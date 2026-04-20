/**
 * Google OAuth client ID for this deployment (public in the browser by design).
 * Change here if you use a different OAuth client.
 *
 * API key: optional; prefer `VITE_GOOGLE_API_KEY` in `.env` / CI (see README).
 * Used for `gapi.client` init and for **direct** anonymous loads on `#view=`
 * links. Without it, public views use a CORS relay instead (see driveService).
 */
const GOOGLE_CLIENT_ID =
  "205907748929-ihek5jm5g93b6bugptg3vss6d4rhd2ed.apps.googleusercontent.com";

const GOOGLE_API_KEY_FALLBACK = "";

const GOOGLE_API_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_GOOGLE_API_KEY?.trim?.()) ||
  GOOGLE_API_KEY_FALLBACK;

/** @returns {{ googleClientId: string, googleApiKey: string }} */
export function getConfig() {
  return {
    googleClientId: GOOGLE_CLIENT_ID,
    googleApiKey: GOOGLE_API_KEY,
  };
}
