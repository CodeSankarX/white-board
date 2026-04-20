import { getConfig } from "./config.js";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Same-tab session only (not localStorage). Survives refresh; cleared on Sign out / tab close. */
const SESSION_STORAGE_KEY = "excalidraw_drive_access";

let accessToken = null;
let tokenClient = null;
/** @type {{ resolve: (t: string) => void, reject: (e: Error) => void } | null} */
let pendingToken = null;

function getClientId() {
  const id = getConfig().googleClientId;
  if (!id) {
    throw new Error("Missing Google OAuth client id — set GOOGLE_CLIENT_ID in src/config.js");
  }
  return id;
}

function persistAccessToken(resp) {
  if (!resp?.access_token) return;
  const expiresIn =
    typeof resp.expires_in === "number" && resp.expires_in > 0
      ? resp.expires_in
      : 3600;
  const expiresAt = Date.now() + expiresIn * 1000 - 60_000;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        accessToken: resp.access_token,
        expiresAt,
      }),
    );
  } catch {
    /* private mode / quota */
  }
}

export function readPersistedAccessToken() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.accessToken || typeof data.expiresAt !== "number") return null;
    if (Date.now() >= data.expiresAt) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    accessToken = data.accessToken;
    return data.accessToken;
  } catch {
    return null;
  }
}

export function clearPersistedAccessToken() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(id);
        resolve();
      } else if (n++ > 200) {
        clearInterval(id);
        reject(new Error("Google Identity Services script did not load"));
      }
    }, 50);
  });
}

export function getAccessToken() {
  return accessToken;
}

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: DRIVE_FILE_SCOPE,
    callback: (resp) => {
      const p = pendingToken;
      pendingToken = null;
      if (!p) return;
      if (resp.error) {
        p.reject(new Error(resp.error));
        return;
      }
      if (resp.access_token) {
        accessToken = resp.access_token;
        persistAccessToken(resp);
        p.resolve(resp.access_token);
      } else {
        p.reject(new Error("No access token returned"));
      }
    },
  });
  return tokenClient;
}

/**
 * Must run from a **user gesture** (click) so the browser allows Google’s popup.
 * Do not call on page load — use `readPersistedAccessToken()` after refresh instead.
 */
export function requestAccessToken() {
  return waitForGoogleIdentity().then(
    () =>
      new Promise((resolve, reject) => {
        pendingToken = { resolve, reject };
        ensureTokenClient().requestAccessToken({ prompt: "" });
      }),
  );
}

/** Clears tokens without revoking (e.g. after HTTP 401). */
export function invalidateSession() {
  pendingToken = null;
  accessToken = null;
  clearPersistedAccessToken();
  if (window.gapi?.client?.setToken) {
    window.gapi.client.setToken(null);
  }
  window.dispatchEvent(new CustomEvent("excalidraw-drive-auth-invalidated"));
}

export function signOut() {
  pendingToken = null;
  const token = accessToken;
  accessToken = null;
  clearPersistedAccessToken();
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  if (window.gapi?.client?.setToken) {
    window.gapi.client.setToken(null);
  }
}
