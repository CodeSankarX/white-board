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
