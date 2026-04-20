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

function formatDriveHttpError(status, bodyText) {
  const raw = (bodyText || "").trim();
  if (raw) {
    try {
      const j = JSON.parse(raw);
      const msg = j?.error?.message;
      if (typeof msg === "string" && msg.length) {
        return `${msg} (HTTP ${status})`;
      }
    } catch {
      /* not JSON */
    }
    const clip = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
    return clip || `HTTP ${status}`;
  }
  return `HTTP ${status}`;
}

/**
 * One-shot Drive file create with binary body (multipart/related).
 * More reliable than metadata-only create + PATCH media (often fails with drive.file + fetch).
 * @param {{ name: string; parents: string[]; mimeType: string }} metadata
 * @param {Blob} mediaBlob
 * @returns {Promise<{ id: string; name?: string }>}
 */
async function driveMultipartCreateFile(metadata, mediaBlob) {
  const token = window.gapi?.client?.getToken?.()?.access_token;
  if (!token) {
    throw new Error("Not authenticated");
  }
  const boundary = `gcSnap_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const metaJson = JSON.stringify(metadata);
  const partMeta =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metaJson}\r\n`;
  const partMediaHead =
    `--${boundary}\r\n` +
    `Content-Type: ${metadata.mimeType}\r\n\r\n`;
  const partEnd = `\r\n--${boundary}--\r\n`;
  const body = new Blob([partMeta, partMediaHead, mediaBlob, partEnd]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatDriveHttpError(res.status, text));
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Drive returned invalid JSON after PNG upload");
  }
  if (!parsed?.id) {
    throw new Error("Drive upload did not return a file id");
  }
  return { id: parsed.id, name: parsed.name };
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
      throw new Error(formatDriveHttpError(res.status, text));
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

/** Try several media URLs (My Drive vs shared drives differ on supportsAllDrives). */
async function driveFetchFirstWorkingUrl(urls, init = {}) {
  let lastErr;
  for (const path of urls) {
    try {
      return await driveFetch(path, init);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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

function fileAltMediaUrls(fileId) {
  const id = encodeURIComponent(fileId);
  return [
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
  ];
}

function revisionAltMediaUrls(fileId, revisionId) {
  const f = encodeURIComponent(fileId);
  const r = encodeURIComponent(revisionId);
  const base = `https://www.googleapis.com/drive/v3/files/${f}/revisions/${r}`;
  return [
    `${base}?alt=media`,
    `${base}?alt=media&supportsAllDrives=true`,
  ];
}

export async function downloadFileText(fileId) {
  return with401Clear(async () => {
    const res = await driveFetchFirstWorkingUrl(fileAltMediaUrls(fileId), {
      method: "GET",
    });
    return res.text();
  });
}

function assertLooksLikePngBlob(blob) {
  if (!blob || blob.size < 24) {
    throw new Error("Downloaded file is empty or too small for a PNG");
  }
  const head = new Uint8Array(blob.slice(0, 8));
  const isPng =
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a;
  if (isPng) return;
  const probe = new TextDecoder("utf-8", { fatal: false }).decode(head);
  throw new Error(
    `Drive did not return PNG bytes (got ${blob.type || "unknown"}; starts with: ${probe.replace(/\s+/g, " ").slice(0, 48)})`,
  );
}

/** Binary file (e.g. snapshot PNG) for authenticated in-app previews. */
export async function downloadDriveFileBlob(fileId) {
  return with401Clear(async () => {
    const res = await driveFetchFirstWorkingUrl(fileAltMediaUrls(fileId), {
      method: "GET",
    });
    const blob = await res.blob();
    assertLooksLikePngBlob(blob);
    return blob;
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
    `All relays failed: ${errors.join(" · ")}. Try another network or disable strict blockers.`,
  );
}

/**
 * Public `.excalidraw` on Drive, **Anyone with the link can view**, no user OAuth.
 * Tries unauthenticated `alt=media` (usually fails), then Drive’s
 * `uc?export=download` flow via a public CORS relay (handles virus-scan HTML).
 */
export async function downloadPublicDriveFileText(fileId) {
  const idEnc = encodeURIComponent(fileId);
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${idEnc}?alt=media`;

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
      "Could not load this diagram. Enable “Anyone with the link can view” on the file.",
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
        supportsAllDrives: true,
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
    const res = await driveFetchFirstWorkingUrl(
      revisionAltMediaUrls(fileId, revisionId),
      { method: "GET" },
    );
    return res.text();
  });
}

/**
 * Download revision JSON. Uses `files.get` alt=media for the **latest** revision
 * (Drive recommends this for current content; `revisions.get` can fail for head).
 * Pass `latestRevisionId` from `listDriveRevisions` (newest-first → first item).
 */
export async function downloadAnyRevisionText(
  fileId,
  revisionId,
  latestRevisionId,
) {
  if (latestRevisionId && revisionId === latestRevisionId) {
    return downloadFileText(fileId);
  }
  return downloadRevisionText(fileId, revisionId);
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

const SNAPSHOTS_FOLDER_NAME = "Gcalidraw save images";
const SNAPSHOT_NAME_PREFIX = "snap__";
/** Keep at most this many PNG snapshots per diagram (oldest trashed after each new save). */
const SNAPSHOT_MAX_PER_DIAGRAM = 40;

const snapshotsFolderIdByParent = new Map();

export function clearSnapshotsFolderIdCache() {
  snapshotsFolderIdByParent.clear();
}

function sanitizeSnapshotStem(name) {
  const base = (name || "diagram").replace(/\.excalidraw$/i, "");
  const cleaned = base.replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 80);
  return cleaned || "diagram";
}

/**
 * Subfolder under the Excalidraw Drive folder; holds PNGs created on each save.
 * @param {string} excalidrawFolderId
 */
export async function ensureSnapshotsFolderId(excalidrawFolderId) {
  return with401Clear(async () => {
    const cached = snapshotsFolderIdByParent.get(excalidrawFolderId);
    if (cached) return cached;
    const q = `'${excalidrawFolderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${SNAPSHOTS_FOLDER_NAME}'`;
    const list = await window.gapi.client.drive.files.list({
      q,
      fields: "files(id)",
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const hit = list.result.files?.[0]?.id;
    if (hit) {
      snapshotsFolderIdByParent.set(excalidrawFolderId, hit);
      return hit;
    }
    const created = await window.gapi.client.drive.files.create({
      resource: {
        name: SNAPSHOTS_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
        parents: [excalidrawFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const id = created.result.id;
    snapshotsFolderIdByParent.set(excalidrawFolderId, id);
    return id;
  });
}

function snapshotNamePrefix(sourceFileId) {
  return `${SNAPSHOT_NAME_PREFIX}${sourceFileId}__`;
}

function isSnapshotForSource(file, sourceFileId) {
  const prefix = snapshotNamePrefix(sourceFileId);
  if (!file?.name?.startsWith(prefix)) return false;
  const mt = file.mimeType || "";
  if (mt === "image/png" || mt.startsWith("image/")) return true;
  return /\.png$/i.test(file.name);
}

async function listAllSnapshotFolderFiles(snapFolderId) {
  const q = `'${snapFolderId}' in parents and trashed=false`;
  const res = await window.gapi.client.drive.files.list({
    q,
    fields:
      "files(id, name, mimeType, createdTime, thumbnailLink, webViewLink, iconLink)",
    orderBy: "createdTime desc",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.result.files || [];
}

/**
 * List PNG save snapshots for one .excalidraw file (newest first).
 * Uses a broad Drive query then filters client-side — `name contains` + strict
 * mime in `q` often returns nothing even when files exist.
 * @param {string} excalidrawFolderId
 * @param {string} sourceFileId
 */
export async function listDiagramSnapshots(excalidrawFolderId, sourceFileId) {
  return with401Clear(async () => {
    const snapFolderId = await ensureSnapshotsFolderId(excalidrawFolderId);
    const raw = await listAllSnapshotFolderFiles(snapFolderId);
    const filtered = raw.filter((f) => isSnapshotForSource(f, sourceFileId));
    filtered.sort(
      (a, b) =>
        new Date(b.createdTime || 0).getTime() -
        new Date(a.createdTime || 0).getTime(),
    );
    return filtered.slice(0, SNAPSHOT_MAX_PER_DIAGRAM);
  });
}

/**
 * Resolve the snapshots subfolder id without creating it (for delete-only flows).
 * @param {string} excalidrawFolderId
 * @returns {Promise<string|null>}
 */
async function getSnapshotsFolderIdIfExists(excalidrawFolderId) {
  const cached = snapshotsFolderIdByParent.get(excalidrawFolderId);
  if (cached) return cached;
  const q = `'${excalidrawFolderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${SNAPSHOTS_FOLDER_NAME}'`;
  const list = await window.gapi.client.drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const hit = list.result.files?.[0]?.id;
  if (hit) snapshotsFolderIdByParent.set(excalidrawFolderId, hit);
  return hit ?? null;
}

/**
 * Move every PNG snapshot for this diagram to Drive trash (e.g. after restoring an older revision).
 * Snapshots live in the "Gcalidraw save images" subfolder of the Excalidraw Drive folder.
 * @returns {Promise<{ deleted: number }>}
 */
export async function trashAllDiagramSnapshots(excalidrawFolderId, sourceFileId) {
  return with401Clear(async () => {
    const snapFolderId = await getSnapshotsFolderIdIfExists(excalidrawFolderId);
    if (!snapFolderId) return { deleted: 0 };
    const raw = await listAllSnapshotFolderFiles(snapFolderId);
    const matches = raw.filter((f) => isSnapshotForSource(f, sourceFileId));
    for (const f of matches) {
      await trashFile(f.id);
    }
    return { deleted: matches.length };
  });
}

async function listSnapshotFilesOldestFirst(snapFolderId, sourceFileId) {
  const raw = await listAllSnapshotFolderFiles(snapFolderId);
  const filtered = raw.filter((f) => isSnapshotForSource(f, sourceFileId));
  filtered.sort(
    (a, b) =>
      new Date(a.createdTime || 0).getTime() -
      new Date(b.createdTime || 0).getTime(),
  );
  return filtered;
}

async function pruneDiagramSnapshots(snapFolderId, sourceFileId) {
  const files = await listSnapshotFilesOldestFirst(snapFolderId, sourceFileId);
  const excess = files.length - SNAPSHOT_MAX_PER_DIAGRAM;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) {
    await trashFile(files[i].id);
  }
}

/**
 * Upload one PNG after the JSON body was saved; trims older snapshots for this diagram.
 */
export async function saveDiagramSnapshotAfterJsonSave({
  excalidrawFolderId,
  sourceFileId,
  sourceDisplayName,
  pngBlob,
}) {
  return with401Clear(async () => {
    const snapFolderId = await ensureSnapshotsFolderId(excalidrawFolderId);
    const label = sanitizeSnapshotStem(sourceDisplayName);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${SNAPSHOT_NAME_PREFIX}${sourceFileId}__${ts}__${label}.png`;
    const created = await driveMultipartCreateFile(
      {
        name,
        parents: [snapFolderId],
        mimeType: "image/png",
      },
      pngBlob,
    );
    await pruneDiagramSnapshots(snapFolderId, sourceFileId);
    return { id: created.id, name: created.name ?? name };
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
