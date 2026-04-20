import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Excalidraw,
  exportToBlob,
  getNonDeletedElements,
  MIME_TYPES,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  readPersistedAccessToken,
  requestAccessToken,
  signOut as gisSignOut,
} from "./auth.js";
import {
  clearSnapshotsFolderIdCache,
  createTextFile,
  downloadAnyRevisionText,
  downloadFileText,
  findAppFolderId,
  initDriveClient,
  listDriveRevisions,
  listExcalidrawFiles,
  renameFile,
  saveDiagramSnapshotAfterJsonSave,
  setDriveAccessToken,
  trashAllDiagramSnapshots,
  updateFileContent,
} from "./driveService.js";
import { FileManager } from "./components/FileManager.jsx";
import { ShareDialog } from "./components/ShareDialog.jsx";
import { ShortcutsHelp } from "./components/ShortcutsHelp.jsx";
import { TextInputModal } from "./components/TextInputModal.jsx";
import { Toolbar } from "./components/Toolbar.jsx";
import { VersionHistory } from "./components/VersionHistory.jsx";
import { useAutoSave } from "./hooks/useAutoSave.js";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";

const AUTOSAVE_MS = 30000;

/** Avoid duplicate session restore in React StrictMode (dev). */
let sessionRestoreAttempted = false;

/** Resume this diagram after refresh when it still exists in Drive. */
const LAST_DIAGRAM_ID_KEY = "excalidraw_drive_last_diagram_id";

/** Guest / signed-out sketch persisted in this tab (sessionStorage). */
const LOCAL_DRAFT_KEY = "excalidraw_drive_local_draft";

function emptySerialized() {
  return serializeAsJSON([], {}, {}, "local");
}

function sceneFromSerialized(serialized) {
  const data = restore(
    JSON.parse(serialized),
    null,
    null,
    { repairBindings: true },
  );
  return {
    elements: data.elements,
    appState: data.appState,
    files: data.files,
  };
}

function readGuestDraftSerialized() {
  try {
    const raw = sessionStorage.getItem(LOCAL_DRAFT_KEY);
    return raw?.trim() ? raw : null;
  } catch {
    return null;
  }
}

function initialGuestScene() {
  const stored = readGuestDraftSerialized();
  if (stored) {
    try {
      return sceneFromSerialized(stored);
    } catch {
      /* fall through */
    }
  }
  return sceneFromSerialized(emptySerialized());
}

function pickResumedFile(files) {
  if (!files?.length) return null;
  try {
    const id = sessionStorage.getItem(LAST_DIAGRAM_ID_KEY);
    if (id) {
      const hit = files.find((f) => f.id === id);
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }
  return files[0];
}

export default function App() {
  const apiRef = useRef(null);
  const lastSavedSerializedRef = useRef(null);
  const localPersistTimerRef = useRef(null);

  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [booting, setBooting] = useState(false);
  const [openingRemoteFile, setOpeningRemoteFile] = useState(false);
  const [folderId, setFolderId] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [initialScene, setInitialScene] = useState(() => initialGuestScene());
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileSearchFocusNonce, setFileSearchFocusNonce] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  /** Excalidraw shares one global editor store; only one instance can be mounted. */
  const [revisionPreviewActive, setRevisionPreviewActive] = useState(false);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [renameCurrentOpen, setRenameCurrentOpen] = useState(false);
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const getSerialized = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return lastSavedSerializedRef.current ?? emptySerialized();
    }
    return serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
      "local",
    );
  }, []);

  const saveToDrive = useCallback(
    async (serialized) => {
      if (!activeFile?.id) return;
      await updateFileContent(activeFile.id, serialized);
      if (!folderId || revisionPreviewActive) return;
      const api = apiRef.current;
      if (!api) return;
      try {
        const appState = api.getAppState();
        const elements = getNonDeletedElements(api.getSceneElements());
        const blob = await exportToBlob({
          elements,
          appState: {
            ...appState,
            exportBackground: true,
          },
          files: api.getFiles(),
          mimeType: MIME_TYPES.png,
          exportPadding: 12,
          maxWidthOrHeight: 2400,
        });
        if (!blob || blob.size < 32) {
          throw new Error("PNG export was empty or too small");
        }
        await saveDiagramSnapshotAfterJsonSave({
          excalidrawFolderId: folderId,
          sourceFileId: activeFile.id,
          sourceDisplayName: activeFile.name,
          pngBlob: blob,
        });
      } catch (e) {
        console.warn("PNG snapshot upload failed", e);
        showToast(
          `Could not save PNG to Drive: ${e?.message || String(e)}`.slice(
            0,
            220,
          ),
        );
      }
    },
    [activeFile, folderId, revisionPreviewActive, showToast],
  );

  const { status: saveStatus, lastSavedAt, bump, saveNow, isDirty } =
    useAutoSave({
      intervalMs: AUTOSAVE_MS,
      enabled: Boolean(signedIn && activeFile?.id && initialScene),
      getSerialized,
      lastSavedSerializedRef,
      save: saveToDrive,
    });

  const hasUnsavedChanges =
    Boolean(initialScene && !booting) && isDirty();

  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (!signedIn || !activeFile?.id || booting || !initialScene) return;
      if (!isDirty()) return;
      void saveNow().catch(() => {});
    };
    document.addEventListener("visibilitychange", flushIfHidden);
    return () =>
      document.removeEventListener("visibilitychange", flushIfHidden);
  }, [signedIn, activeFile?.id, booting, initialScene, saveNow, isDirty]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!initialScene || booting || !isDirty()) return;
      if (signedIn && !activeFile?.id) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [signedIn, activeFile?.id, initialScene, booting, isDirty]);

  useLayoutEffect(() => {
    if (readPersistedAccessToken()) return;
    try {
      const s = readGuestDraftSerialized();
      lastSavedSerializedRef.current =
        s && s.trim() ? s.trim() : emptySerialized().trim();
    } catch {
      lastSavedSerializedRef.current = emptySerialized().trim();
    }
  }, []);

  const hydrateDriveWorkspace = useCallback(
    async (token, { uploadLocalDraft } = {}) => {
      await initDriveClient(token);
      setDriveAccessToken(token);
      const folder = await findAppFolderId();
      setFolderId(folder);
      const emptyTrim = emptySerialized().trim();
      const draft =
        typeof uploadLocalDraft === "string"
          ? uploadLocalDraft.trim()
          : "";

      if (draft && draft !== emptyTrim) {
        const fileMeta = await createTextFile(
          folder,
          "Untitled.excalidraw",
          uploadLocalDraft,
        );
        setActiveFile({ id: fileMeta.id, name: fileMeta.name });
        setInitialScene(sceneFromSerialized(uploadLocalDraft));
        lastSavedSerializedRef.current = draft;
        try {
          sessionStorage.removeItem(LOCAL_DRAFT_KEY);
        } catch {
          /* ignore */
        }
      } else {
        const list = await listExcalidrawFiles(folder);
        let fileMeta;
        let content;
        if (list.length === 0) {
          const empty = emptySerialized();
          fileMeta = await createTextFile(folder, "Untitled.excalidraw", empty);
          content = empty;
        } else {
          fileMeta = pickResumedFile(list);
          content = await downloadFileText(fileMeta.id);
        }
        setActiveFile({ id: fileMeta.id, name: fileMeta.name });
        setInitialScene(sceneFromSerialized(content));
        lastSavedSerializedRef.current = content.trim();
      }
      setSignedIn(true);
    },
    [],
  );

  const bootstrapSessionRef = useRef(null);
  const bootstrapSession = useCallback(
    async (token) => {
      setBooting(true);
      try {
        await hydrateDriveWorkspace(token, { uploadLocalDraft: null });
      } catch (e) {
        console.error(e);
        showToast(e?.message || String(e));
        gisSignOut();
        setSignedIn(false);
      } finally {
        setBooting(false);
      }
    },
    [hydrateDriveWorkspace, showToast],
  );

  useEffect(() => {
    if (activeFile?.id) {
      try {
        sessionStorage.setItem(LAST_DIAGRAM_ID_KEY, activeFile.id);
      } catch {
        /* ignore */
      }
    }
    setSceneEpoch(0);
  }, [activeFile?.id]);

  bootstrapSessionRef.current = bootstrapSession;

  useEffect(() => {
    if (sessionRestoreAttempted) return;
    sessionRestoreAttempted = true;
    const token = readPersistedAccessToken();
    if (!token) return;
    (async () => {
      try {
        await bootstrapSessionRef.current(token);
      } catch {
        gisSignOut();
      }
    })();
  }, []);

  useEffect(() => {
    const onInvalidated = () => {
      let snap = lastSavedSerializedRef.current ?? emptySerialized();
      try {
        const api = apiRef.current;
        if (api) {
          snap = serializeAsJSON(
            api.getSceneElements(),
            api.getAppState(),
            api.getFiles(),
            "local",
          );
        }
      } catch {
        /* keep snap */
      }
      setSignedIn(false);
      setFolderId(null);
      clearSnapshotsFolderIdCache();
      setActiveFile(null);
      try {
        setInitialScene(sceneFromSerialized(snap));
        lastSavedSerializedRef.current = snap.trim();
        sessionStorage.setItem(LOCAL_DRAFT_KEY, snap);
      } catch {
        setInitialScene(sceneFromSerialized(emptySerialized()));
        lastSavedSerializedRef.current = emptySerialized().trim();
      }
      setSceneEpoch((n) => n + 1);
      apiRef.current = null;
      showToast("Your Google session expired. You can keep editing locally; sign in again to save to Drive.");
    };
    window.addEventListener("excalidraw-drive-auth-invalidated", onInvalidated);
    return () =>
      window.removeEventListener(
        "excalidraw-drive-auth-invalidated",
        onInvalidated,
      );
  }, [showToast]);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      const token = await requestAccessToken();
      const draft = getSerialized();
      setSigningIn(false);
      setBooting(true);
      try {
        await hydrateDriveWorkspace(token, { uploadLocalDraft: draft });
      } catch (e) {
        console.error(e);
        showToast(e?.message || String(e));
        gisSignOut();
        setSignedIn(false);
      } finally {
        setBooting(false);
      }
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Sign-in failed");
      setSigningIn(false);
    }
  }, [getSerialized, hydrateDriveWorkspace, showToast]);

  const handleSignOut = useCallback(() => {
    let snap = lastSavedSerializedRef.current ?? emptySerialized();
    try {
      const api = apiRef.current;
      if (api) {
        snap = serializeAsJSON(
          api.getSceneElements(),
          api.getAppState(),
          api.getFiles(),
          "local",
        );
      }
    } catch {
      /* keep snap */
    }
    gisSignOut();
    clearSnapshotsFolderIdCache();
    try {
      sessionStorage.removeItem(LAST_DIAGRAM_ID_KEY);
    } catch {
      /* ignore */
    }
    setSignedIn(false);
    setFolderId(null);
    setActiveFile(null);
    try {
      sessionStorage.setItem(LOCAL_DRAFT_KEY, snap);
      setInitialScene(sceneFromSerialized(snap));
      lastSavedSerializedRef.current = snap.trim();
    } catch {
      setInitialScene(sceneFromSerialized(emptySerialized()));
      lastSavedSerializedRef.current = emptySerialized().trim();
    }
    setSceneEpoch((n) => n + 1);
    apiRef.current = null;
  }, []);

  const handleExcalidrawChange = useCallback(() => {
    bump();
    if (signedIn) return;
    window.clearTimeout(localPersistTimerRef.current);
    localPersistTimerRef.current = window.setTimeout(() => {
      try {
        sessionStorage.setItem(LOCAL_DRAFT_KEY, getSerialized());
      } catch {
        /* quota / private mode */
      }
    }, 500);
  }, [bump, signedIn, getSerialized]);

  useEffect(() => {
    return () => {
      window.clearTimeout(localPersistTimerRef.current);
    };
  }, []);

  const resetGuestCanvas = useCallback(() => {
    const empty = emptySerialized();
    setInitialScene(sceneFromSerialized(empty));
    lastSavedSerializedRef.current = empty.trim();
    try {
      sessionStorage.setItem(LOCAL_DRAFT_KEY, empty);
    } catch {
      /* ignore */
    }
    setActiveFile(null);
    setSceneEpoch((n) => n + 1);
  }, []);

  const handleOpenRemoteFile = useCallback(
    async (f) => {
      if (!signedIn) {
        showToast("Sign in to open files from Google Drive.");
        return false;
      }
      if (f.id === activeFile?.id) {
        setFileManagerOpen(false);
        return true;
      }
      if (
        isDirty() &&
        !window.confirm("Discard unsaved changes and open this file?")
      ) {
        return false;
      }
      setOpeningRemoteFile(true);
      try {
        const text = await downloadFileText(f.id);
        const data = restore(
          JSON.parse(text),
          null,
          null,
          { repairBindings: true },
        );
        setActiveFile({ id: f.id, name: f.name });
        setInitialScene({
          elements: data.elements,
          appState: data.appState,
          files: data.files,
        });
        lastSavedSerializedRef.current = text.trim();
        setFileManagerOpen(false);
        return true;
      } catch (e) {
        console.error(e);
        showToast(e?.message || "Could not open file");
        return false;
      } finally {
        setOpeningRemoteFile(false);
      }
    },
    [activeFile?.id, isDirty, showToast, signedIn],
  );

  const handleNewDiagram = useCallback(async () => {
    if (!signedIn) {
      if (
        isDirty() &&
        !window.confirm(
          "Discard your local sketch and start a new blank canvas?",
        )
      ) {
        return;
      }
      resetGuestCanvas();
      return;
    }
    if (!folderId) return;
    if (
      isDirty() &&
      !window.confirm("Discard unsaved changes and create a new diagram?")
    ) {
      return;
    }
    setNewDiagramOpen(true);
  }, [signedIn, isDirty, folderId, resetGuestCanvas]);

  const applyNewDiagram = useCallback(
    async (nameRaw) => {
      if (!folderId) return;
      const trimmed = nameRaw.trim();
      if (!trimmed) {
        setNewDiagramOpen(false);
        return;
      }
      try {
        const empty = emptySerialized();
        const fileMeta = await createTextFile(folderId, trimmed, empty);
        const data = restore(
          JSON.parse(empty),
          null,
          null,
          { repairBindings: true },
        );
        setActiveFile({ id: fileMeta.id, name: fileMeta.name });
        setInitialScene({
          elements: data.elements,
          appState: data.appState,
          files: data.files,
        });
        lastSavedSerializedRef.current = empty.trim();
        setNewDiagramOpen(false);
      } catch (e) {
        console.error(e);
        showToast(e?.message || "Could not create file");
        throw e;
      }
    },
    [folderId, showToast],
  );

  const handleManualSave = useCallback(async () => {
    if (!signedIn || !activeFile?.id) {
      showToast("Sign in with Google to save to Drive.");
      return;
    }
    try {
      await saveNow();
    } catch (e) {
      showToast(e?.message || "Save failed");
    }
  }, [signedIn, activeFile?.id, saveNow, showToast]);

  const handleRenameCurrent = useCallback(() => {
    if (!activeFile?.id) {
      showToast("Sign in and open a Drive file to rename it.");
      return;
    }
    setRenameCurrentOpen(true);
  }, [activeFile?.id, showToast]);

  const applyRenameCurrent = useCallback(
    async (next) => {
      if (!activeFile?.id) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === activeFile.name) {
        setRenameCurrentOpen(false);
        return;
      }
      try {
        const name = await renameFile(activeFile.id, trimmed);
        setActiveFile((prev) => (prev ? { ...prev, name } : prev));
        showToast(`Renamed to ${name}`);
        setRenameCurrentOpen(false);
      } catch (e) {
        showToast(e?.message || "Rename failed");
        throw e;
      }
    },
    [activeFile, showToast],
  );

  const handleDuplicateFile = useCallback(
    async (f) => {
      if (!folderId) return;
      try {
        const text = await downloadFileText(f.id);
        const base = f.name.replace(/\.excalidraw$/i, "");
        const newName = `Copy of ${base}.excalidraw`;
        const meta = await createTextFile(folderId, newName, text);
        showToast(`Created ${meta.name}`);
      } catch (e) {
        showToast(e?.message || "Duplicate failed");
        throw e;
      }
    },
    [folderId, showToast],
  );

  const handleRestoreRevision = useCallback(
    async (revisionId) => {
      if (!activeFile?.id) return;
      const msg = isDirty()
        ? "Discard unsaved edits and replace the diagram with this Drive version? Google Drive will be updated."
        : "Replace the current diagram on Google Drive with this saved version?";
      if (!window.confirm(msg)) return;
      try {
        const revs = await listDriveRevisions(activeFile.id);
        const headId = revs[0]?.id;
        const text = await downloadAnyRevisionText(
          activeFile.id,
          revisionId,
          headId,
        );
        await updateFileContent(activeFile.id, text);
        const data = restore(
          JSON.parse(text),
          null,
          null,
          { repairBindings: true },
        );
        lastSavedSerializedRef.current = text.trim();
        setInitialScene({
          elements: data.elements,
          appState: data.appState,
          files: data.files,
        });
        setSceneEpoch((e) => e + 1);
        let snapshotMsg = "";
        if (folderId) {
          try {
            const { deleted } = await trashAllDiagramSnapshots(
              folderId,
              activeFile.id,
            );
            if (deleted > 0) {
              snapshotMsg = ` Removed ${deleted} save preview image${deleted === 1 ? "" : "s"}.`;
            }
          } catch {
            snapshotMsg =
              " Could not remove old save preview images from Drive.";
          }
        }
        showToast(
          `Restored a version from Drive history.${snapshotMsg}`,
        );
      } catch (e) {
        showToast(e?.message || "Could not restore version");
        throw e;
      }
    },
    [activeFile?.id, folderId, isDirty, showToast],
  );

  useKeyboardShortcuts(
    () => ({
      signedIn,
      booting,
      savingDisabled: booting || !signedIn || !activeFile?.id,
      fileManagerOpen,
      shortcutsOpen,
      versionHistoryOpen,
      hasFolder: Boolean(folderId),
      hasActiveFile: Boolean(activeFile?.id),
    }),
    {
      onSave: () => {
        void handleManualSave();
      },
      onOpenFiles: () => setFileManagerOpen(true),
      onOpenFileSearch: () => {
        setFileManagerOpen(true);
        setFileSearchFocusNonce((n) => n + 1);
      },
      onNewDiagram: () => {
        void handleNewDiagram();
      },
      onRenameCurrent: () => {
        void handleRenameCurrent();
      },
      onCloseFileManager: () => setFileManagerOpen(false),
      onOpenShortcuts: () => setShortcutsOpen(true),
      onCloseShortcuts: () => setShortcutsOpen(false),
      onCloseVersionHistory: () => setVersionHistoryOpen(false),
    },
  );

  return (
    <div className="app-root">
      <Toolbar
        signedIn={signedIn}
        signInBusy={signingIn}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        fileName={activeFile?.name ?? (!signedIn ? "Local sketch" : undefined)}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        hasUnsavedChanges={hasUnsavedChanges}
        autoSaveAfterSec={Math.round(AUTOSAVE_MS / 1000)}
        onSave={handleManualSave}
        onOpenFiles={() => setFileManagerOpen(true)}
        onNewDiagram={handleNewDiagram}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenVersions={
          signedIn && activeFile?.id
            ? () => setVersionHistoryOpen(true)
            : undefined
        }
        onShare={
          signedIn && activeFile?.id
            ? () =>
                setShareTarget({
                  id: activeFile.id,
                  name: activeFile.name,
                })
            : undefined
        }
        onRenameFileClick={signedIn ? handleRenameCurrent : undefined}
        savingDisabled={booting || !signedIn || !activeFile?.id}
      />
      <div className="app-canvas-wrap">
        {booting && (
          <div className="app-overlay app-overlay--booting" role="status">
            <div className="app-overlay__card">
              <span className="app-overlay__spinner" aria-hidden="true" />
              <p className="app-overlay__title">Connecting to Drive</p>
              <p className="app-overlay__sub">Preparing your Gcalidraw workspace…</p>
            </div>
          </div>
        )}
        {openingRemoteFile && !booting && (
          <div className="app-overlay app-overlay--booting" role="status">
            <div className="app-overlay__card">
              <span className="app-overlay__spinner" aria-hidden="true" />
              <p className="app-overlay__title">Opening file</p>
              <p className="app-overlay__sub">Downloading from Google Drive…</p>
            </div>
          </div>
        )}
        {initialScene && !booting && !revisionPreviewActive && (
          <Excalidraw
            key={
              activeFile?.id
                ? `${activeFile.id}-${sceneEpoch}`
                : `guest-${sceneEpoch}`
            }
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            initialData={{
              elements: initialScene.elements,
              appState: initialScene.appState,
              files: initialScene.files,
            }}
            onChange={handleExcalidrawChange}
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
              },
            }}
          />
        )}
      </div>
      <FileManager
        open={fileManagerOpen}
        onClose={() => setFileManagerOpen(false)}
        folderId={folderId}
        activeFileId={activeFile?.id}
        onOpenFile={handleOpenRemoteFile}
        onDuplicateFile={signedIn ? handleDuplicateFile : undefined}
        onShareFile={
          signedIn ? (f) => setShareTarget({ id: f.id, name: f.name }) : undefined
        }
        focusSearchNonce={fileSearchFocusNonce}
      />
      <ShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        autoSaveAfterSec={Math.round(AUTOSAVE_MS / 1000)}
      />
      <VersionHistory
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        fileId={activeFile?.id}
        fileName={activeFile?.name}
        excalidrawFolderId={folderId}
        onRestoreRevision={handleRestoreRevision}
        showToast={showToast}
        onRevisionPreviewActiveChange={setRevisionPreviewActive}
      />
      <ShareDialog
        open={Boolean(shareTarget)}
        fileId={shareTarget?.id}
        fileName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
        showToast={showToast}
      />
      <TextInputModal
        open={renameCurrentOpen}
        title="Rename diagram"
        label="File name"
        initialValue={activeFile?.name ?? ""}
        confirmLabel="Rename"
        cancelLabel="Cancel"
        helperText="Include .excalidraw or it will be added for you."
        onClose={() => setRenameCurrentOpen(false)}
        onConfirm={applyRenameCurrent}
      />
      <TextInputModal
        open={newDiagramOpen}
        title="New diagram"
        label="File name"
        initialValue="Untitled"
        confirmLabel="Create"
        cancelLabel="Cancel"
        helperText="Saved as .excalidraw in your Excalidraw Drive folder."
        onClose={() => setNewDiagramOpen(false)}
        onConfirm={applyNewDiagram}
      />
      <div className="app-toast" hidden={!toast} role="alert">
        {toast}
      </div>
    </div>
  );
}
