import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  readPersistedAccessToken,
  requestAccessToken,
  signOut as gisSignOut,
} from "./auth.js";
import {
  createTextFile,
  downloadFileText,
  downloadRevisionText,
  findAppFolderId,
  initDriveClient,
  listExcalidrawFiles,
  renameFile,
  setDriveAccessToken,
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

function emptySerialized() {
  return serializeAsJSON([], {}, {}, "local");
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

  const [signedIn, setSignedIn] = useState(false);
  const [booting, setBooting] = useState(false);
  const [folderId, setFolderId] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [initialScene, setInitialScene] = useState(null);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileSearchFocusNonce, setFileSearchFocusNonce] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [renameCurrentOpen, setRenameCurrentOpen] = useState(false);
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [toast, setToast] = useState(null);

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
    },
    [activeFile?.id],
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
    Boolean(signedIn && initialScene && activeFile && !booting) && isDirty();

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
      if (!signedIn || !activeFile?.id || !initialScene) return;
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [signedIn, activeFile?.id, initialScene, isDirty]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const bootstrapSessionRef = useRef(null);
  const bootstrapSession = useCallback(async (token) => {
    setBooting(true);
    try {
      await initDriveClient(token);
      setDriveAccessToken(token);
      const folder = await findAppFolderId();
      setFolderId(folder);
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
      const data = restore(
        JSON.parse(content),
        null,
        null,
        { repairBindings: true },
      );
      setInitialScene({
        elements: data.elements,
        appState: data.appState,
        files: data.files,
      });
      lastSavedSerializedRef.current = content.trim();
      setSignedIn(true);
    } catch (e) {
      console.error(e);
      showToast(e?.message || String(e));
      gisSignOut();
      setSignedIn(false);
    } finally {
      setBooting(false);
    }
  }, [showToast]);

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
      setSignedIn(false);
      setFolderId(null);
      setActiveFile(null);
      setInitialScene(null);
      lastSavedSerializedRef.current = null;
      apiRef.current = null;
      showToast("Your Google session expired. Sign in again.");
    };
    window.addEventListener("excalidraw-drive-auth-invalidated", onInvalidated);
    return () =>
      window.removeEventListener(
        "excalidraw-drive-auth-invalidated",
        onInvalidated,
      );
  }, [showToast]);

  const handleSignIn = useCallback(async () => {
    try {
      const token = await requestAccessToken();
      await bootstrapSession(token);
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Sign-in failed");
    }
  }, [bootstrapSession, showToast]);

  const handleSignOut = useCallback(() => {
    gisSignOut();
    try {
      sessionStorage.removeItem(LAST_DIAGRAM_ID_KEY);
    } catch {
      /* ignore */
    }
    setSignedIn(false);
    setFolderId(null);
    setActiveFile(null);
    setInitialScene(null);
    lastSavedSerializedRef.current = null;
    apiRef.current = null;
  }, []);

  const handleExcalidrawChange = useCallback(() => {
    bump();
  }, [bump]);

  const handleOpenRemoteFile = useCallback(
    async (f) => {
      try {
        if (f.id === activeFile?.id) {
          setFileManagerOpen(false);
          return;
        }
        if (
          isDirty() &&
          !window.confirm("Discard unsaved changes and open this file?")
        ) {
          return;
        }
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
      } catch (e) {
        console.error(e);
        showToast(e?.message || "Could not open file");
      }
    },
    [activeFile?.id, isDirty, showToast],
  );

  const handleNewDiagram = useCallback(async () => {
    if (!folderId) return;
    if (
      isDirty() &&
      !window.confirm("Discard unsaved changes and create a new diagram?")
    ) {
      return;
    }
    setNewDiagramOpen(true);
  }, [folderId, isDirty]);

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
    try {
      await saveNow();
    } catch (e) {
      showToast(e?.message || "Save failed");
    }
  }, [saveNow, showToast]);

  const handleRenameCurrent = useCallback(() => {
    if (!activeFile?.id) return;
    setRenameCurrentOpen(true);
  }, [activeFile?.id]);

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
        const text = await downloadRevisionText(activeFile.id, revisionId);
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
        showToast("Restored a version from Drive history");
      } catch (e) {
        showToast(e?.message || "Could not restore version");
        throw e;
      }
    },
    [activeFile?.id, isDirty, showToast],
  );

  useKeyboardShortcuts(
    () => ({
      signedIn,
      booting,
      savingDisabled: !signedIn || !activeFile || booting,
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
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        fileName={activeFile?.name}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        hasUnsavedChanges={hasUnsavedChanges}
        autoSaveAfterSec={Math.round(AUTOSAVE_MS / 1000)}
        onSave={handleManualSave}
        onOpenFiles={() => setFileManagerOpen(true)}
        onNewDiagram={handleNewDiagram}
        onShowShortcuts={
          signedIn ? () => setShortcutsOpen(true) : undefined
        }
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
        savingDisabled={!signedIn || !activeFile || booting}
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
        {signedIn && initialScene && activeFile && !booting && (
          <Excalidraw
            key={`${activeFile.id}-${sceneEpoch}`}
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
        {!signedIn && !booting && (
          <div className="app-overlay app-overlay--welcome">
            <div className="app-overlay__card app-overlay__card--welcome">
              <div className="app-overlay__deco" aria-hidden="true" />
              <h1 className="app-overlay__hero-title">Welcome to Gcalidraw</h1>
              <p className="app-overlay__hero-text">
                Sketch freely — diagrams save to your Google Drive in the{" "}
                <strong>Excalidraw Drive</strong> folder. No server, your data.
              </p>
              <p className="app-overlay__hint">
                Use <strong>Sign in with Google</strong> in the toolbar to begin.
              </p>
            </div>
          </div>
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
        onRestoreRevision={handleRestoreRevision}
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
