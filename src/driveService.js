import { getConfig } from "./config.js";
import { invalidateSession } from "./auth.js";

const FOLDER_NAME = "Excalidraw Drive";
const DISCOVERY_DOC =
  "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

async function with401Clear(fn) {
  try {
    return await fn();
  } catch (e) {
    const status = e?.status ?? e?.code;
    if (status === 401) {
      invalidateSession();
    }
    throw e;
  }
}

export function waitForGapi() {
  return new Promise((resolve, reject) => {
    if (window.gapi?.load) {
      resolve();
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      if (window.gapi?.load) {
        clearInterval(id);
        resolve();
      } else if (n++ > 200) {
        clearInterval(id);
        reject(new Error("Google API script did not load"));
      }
    }, 50);
  });
}

export async function initDriveClient(accessToken) {
  await waitForGapi();
  await new Promise((resolve, reject) => {
    window.gapi.load("client", async () => {
      try {
        const initOpts = { discoveryDocs: [DISCOVERY_DOC] };
        const apiKey = getConfig().googleApiKey?.trim();
        if (apiKey) {
          initOpts.apiKey = apiKey;
        }
        await window.gapi.client.init(initOpts);
        window.gapi.client.setToken({ access_token: accessToken });
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function setDriveAccessToken(accessToken) {
  if (window.gapi?.client?.setToken) {
    window.gapi.client.setToken(
      accessToken ? { access_token: accessToken } : null,
    );
  }
}

async function driveFetch(path, init = {}) {
  const run = async () => {
    const token = window.gapi?.client?.getToken?.()?.access_token;
    if (!token) {
      throw new Error("Not authenticated");
    }
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (res.status === 401) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res;
  };
  try {
    return await run();
  } catch (e) {
    if (e?.status === 401) {
      invalidateSession();
    }
    throw e;
  }
}

export async function findAppFolderId() {
  return with401Clear(async () => {
    const q = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false and 'root' in parents`;
    const list = await window.gapi.client.drive.files.list({
      q,
      fields: "files(id, name)",
      spaces: "drive",
      pageSize: 10,
    });
    const files = list.result.files || [];
    if (files.length > 0) return files[0].id;
    const created = await window.gapi.client.drive.files.create({
      resource: {
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      },
      fields: "id",
    });
    return created.result.id;
  });
}

export async function listExcalidrawFiles(folderId) {
  return with401Clear(async () => {
    const q = `'${folderId}' in parents and trashed=false and name contains '.excalidraw'`;
    const res = await window.gapi.client.drive.files.list({
      q,
      fields: "files(id, name, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
    });
    return res.result.files || [];
  });
}

export async function createTextFile(folderId, filename, bodyText) {
  return with401Clear(async () => {
    const created = await window.gapi.client.drive.files.create({
      resource: {
        name: filename.endsWith(".excalidraw")
          ? filename
          : `${filename}.excalidraw`,
        parents: [folderId],
        mimeType: "application/json",
      },
      fields: "id, name",
    });
    const id = created.result.id;
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: bodyText,
      },
    );
    return { id, name: created.result.name };
  });
}

export async function updateFileContent(fileId, bodyText) {
  return with401Clear(async () => {
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: bodyText,
      },
    );
  });
}

export async function downloadFileText(fileId) {
  return with401Clear(async () => {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { method: "GET" },
    );
    return res.text();
  });
}

function looksLikeDownloadInterstitialHtml(text) {
  const t = text.trimStart();
  if (!t.startsWith("<!") && !t.startsWith("<html")) return false;
  return (
    /virus scan warning/i.test(t) ||
    /Google Drive - /i.test(t) ||
    /download anyway/i.test(t) ||
    /confirm=/i.test(t)
  );
}

const RELAY_FETCH_MS = 28_000;

/**
 * Fetch a public URL through CORS relays (browser cannot read drive.google.com
 * download responses directly). Tries several services — ad blockers often
 * block one of them.
 */
async function fetchThroughRelays(targetUrl) {
  const encUrl = encodeURIComponent(targetUrl);
  const withTimeout = async (label, url) => {
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), RELAY_FETCH_MS);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) {
        throw new Error(`${label}: HTTP ${res.status}`);
      }
      return await res.text();
    } finally {
      window.clearTimeout(tid);
    }
  };

  const tryAlloriginsGet = async () => {
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), RELAY_FETCH_MS);
    try {
      const res = await fetch(
        `https://api.allorigins.win/get?url=${encUrl}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        throw new Error(`allorigins-json: HTTP ${res.status}`);
      }
      const data = await res.json();
      const c = data?.contents;
      if (c == null) {
        throw new Error("allorigins-json: empty contents");
      }
      return typeof c === "string" ? c : JSON.stringify(c);
    } finally {
      window.clearTimeout(tid);
    }
  };

  const attempts = [
    () =>
      withTimeout(
        "codetabs",
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
      ),
    () =>
      withTimeout(
        "allorigins-raw",
        `https://api.allorigins.win/raw?url=${encUrl}`,
      ),
    tryAlloriginsGet,
    () =>
      withTimeout(
        "corsproxy",
        `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      ),
  ];

  const errors = [];
  for (const run of attempts) {
    try {
      return await run();
    } catch (e) {
      const name = e?.name === "AbortError" ? "timeout" : "";
      errors.push(
        name
          ? `${name} (${e.message || "aborted"})`
          : e?.message || String(e),
      );
    }
  }
  throw new Error(
    `All relays failed: ${errors.join(" · ")}. Try another network, disable strict blockers, or set VITE_GOOGLE_API_KEY for direct Google access.`,
  );
}

/**
 * Public `.excalidraw` on Drive, **Anyone with the link can view**, no user OAuth.
 * - With `googleApiKey`: Drive REST `alt=media` (best: private, fast, CSP-friendly).
 * - Without key: try unauthenticated `alt=media` (usually fails), then Drive’s
 *   `uc?export=download` flow via a public CORS relay (handles virus-scan HTML).
 */
export async function downloadPublicDriveFileText(fileId) {
  const key = getConfig().googleApiKey?.trim();
  const idEnc = encodeURIComponent(fileId);
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${idEnc}?alt=media`;

  if (key) {
    const res = await fetch(
      `${mediaUrl}&key=${encodeURIComponent(key)}`,
    );
    if (res.status === 404) {
      throw new Error("File not found.");
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        "Access denied for anonymous viewing. Turn on “Anyone with the link can view” in Share, and ensure the API key allows the Drive API from this site’s origin.",
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText || `HTTP ${res.status}`);
    }
    return res.text();
  }

  try {
    const res = await fetch(mediaUrl);
    if (res.ok) return res.text();
  } catch {
    /* ignore network errors */
  }

  const ucUrl = (confirmToken) => {
    let u = `https://drive.google.com/uc?export=download&id=${idEnc}`;
    if (confirmToken) u += `&confirm=${encodeURIComponent(confirmToken)}`;
    return u;
  };

  let text = await fetchThroughRelays(ucUrl());
  if (looksLikeDownloadInterstitialHtml(text)) {
    const m = text.match(/confirm=([0-9A-Za-z_-]+)/);
    let confirm = m?.[1];
    if (!confirm && /virus scan warning/i.test(text)) {
      confirm = "t";
    }
    if (confirm) {
      text = await fetchThroughRelays(ucUrl(confirm));
    }
  }
  if (
    !text.trim() ||
    looksLikeDownloadInterstitialHtml(text) ||
    text.trimStart().startsWith("<")
  ) {
    throw new Error(
      "Could not load this diagram. Enable “Anyone with the link can view” on the file, or set VITE_GOOGLE_API_KEY for more reliable anonymous access.",
    );
  }
  return text;
}

/**
 * Google Drive revision history (each save creates a new revision when enabled for the file).
 * @param {string} fileId
 * @returns {Promise<Array<{ id: string; modifiedTime?: string; size?: string }>>}
 */
export async function listDriveRevisions(fileId) {
  return with401Clear(async () => {
    const collected = [];
    let pageToken;
    do {
      const res = await window.gapi.client.drive.revisions.list({
        fileId,
        pageSize: 100,
        fields: "nextPageToken, revisions(id, modifiedTime, size)",
        pageToken: pageToken || undefined,
      });
      const revs = res.result.revisions || [];
      collected.push(...revs);
      pageToken = res.result.nextPageToken;
    } while (pageToken);
    collected.sort((a, b) => {
      const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return tb - ta;
    });
    return collected;
  });
}

/** Download a specific revision’s file bytes as text (same as current file for .excalidraw JSON). */
export async function downloadRevisionText(fileId, revisionId) {
  return with401Clear(async () => {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
      { method: "GET" },
    );
    return res.text();
  });
}

export async function renameFile(fileId, newName) {
  return with401Clear(async () => {
    const name = newName.endsWith(".excalidraw")
      ? newName
      : `${newName}.excalidraw`;
    await window.gapi.client.drive.files.update({
      fileId,
      resource: { name },
    });
    return name;
  });
}

export async function trashFile(fileId) {
  return with401Clear(async () => {
    await window.gapi.client.drive.files.update({
      fileId,
      resource: { trashed: true },
    });
  });
}

/** Web URL to open this file in Google Drive (view / download). */
export function getDriveFileViewUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view?usp=sharing`;
}

/**
 * @param {string} fileId
 * @returns {Promise<Array<{ id: string; type: string; role: string; emailAddress?: string; displayName?: string }>>}
 */
export async function listFilePermissions(fileId) {
  return with401Clear(async () => {
    const collected = [];
    let pageToken;
    do {
      const res = await window.gapi.client.drive.permissions.list({
        fileId,
        pageSize: 100,
        fields: "nextPageToken, permissions(id, type, role, emailAddress, displayName)",
        pageToken: pageToken || undefined,
      });
      const list = res.result.permissions || [];
      collected.push(...list);
      pageToken = res.result.nextPageToken;
    } while (pageToken);
    return collected;
  });
}

/** Grant a specific Google account read access. Sends a Drive notification email by default. */
export async function shareFileWithEmail(
  fileId,
  emailAddress,
  { sendNotificationEmail = true } = {},
) {
  return with401Clear(async () => {
    await window.gapi.client.drive.permissions.create({
      fileId,
      resource: {
        type: "user",
        role: "reader",
        emailAddress: emailAddress.trim(),
      },
      sendNotificationEmail: Boolean(sendNotificationEmail),
      fields: "id",
    });
  });
}

/** Allow anyone with the link to view the file in Drive (not indexed). */
export async function enableAnyoneLinkReader(fileId) {
  return with401Clear(async () => {
    const res = await window.gapi.client.drive.permissions.create({
      fileId,
      resource: {
        type: "anyone",
        role: "reader",
        allowFileDiscovery: false,
      },
      fields: "id",
    });
    return res.result.id;
  });
}

export async function deleteFilePermission(fileId, permissionId) {
  return with401Clear(async () => {
    await window.gapi.client.drive.permissions.delete({
      fileId,
      permissionId,
    });
  });
}
