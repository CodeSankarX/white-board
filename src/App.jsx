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
  findAppFolderId,
  initDriveClient,
  listExcalidrawFiles,
  setDriveAccessToken,
  updateFileContent,
} from "./driveService.js";
import { FileManager } from "./components/FileManager.jsx";
import { Toolbar } from "./components/Toolbar.jsx";
import { useAutoSave } from "./hooks/useAutoSave.js";

const AUTOSAVE_MS = 30000;

/** Avoid duplicate session restore in React StrictMode (dev). */
let sessionRestoreAttempted = false;

function emptySerialized() {
  return serializeAsJSON([], {}, {}, "local");
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
        fileMeta = list[0];
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
    try {
      if (
        isDirty() &&
        !window.confirm("Discard unsaved changes and create a new diagram?")
      ) {
        return;
      }
      const suggested = "Untitled";
      const name = window.prompt("New diagram name", suggested);
      if (!name?.trim()) return;
      const empty = emptySerialized();
      const fileMeta = await createTextFile(
        folderId,
        `${name.trim()}.excalidraw`,
        empty,
      );
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
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Could not create file");
    }
  }, [folderId, isDirty, showToast]);

  const handleManualSave = useCallback(async () => {
    try {
      await saveNow();
    } catch (e) {
      showToast(e?.message || "Save failed");
    }
  }, [saveNow, showToast]);

  return (
    <div className="app-root">
      <Toolbar
        signedIn={signedIn}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        fileName={activeFile?.name}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        onSave={handleManualSave}
        onOpenFiles={() => setFileManagerOpen(true)}
        onNewDiagram={handleNewDiagram}
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
            key={activeFile.id}
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
      />
      <div className="app-toast" hidden={!toast} role="alert">
        {toast}
      </div>
    </div>
  );
}
