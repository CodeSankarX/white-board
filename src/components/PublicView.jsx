import { useEffect, useState } from "react";
import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  downloadPublicDriveFileText,
  getDriveFileViewUrl,
} from "../driveService.js";

export function PublicView({ fileId, onOpenEditor }) {
  const [phase, setPhase] = useState("loading");
  const [scene, setScene] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setScene(null);
    (async () => {
      try {
        const text = await downloadPublicDriveFileText(fileId);
        const data = restore(
          JSON.parse(text),
          null,
          null,
          { repairBindings: true },
        );
        if (!cancelled) {
          setScene({
            elements: data.elements,
            appState: data.appState,
            files: data.files,
          });
          setPhase("ready");
        }
      } catch (e) {
        if (!cancelled) {
          let msg = e?.message || String(e);
          if (/failed to fetch|networkerror|load failed/i.test(msg)) {
            msg = `${msg} — Often caused by a browser extension (ad blocker), strict network policy, or Content-Security-Policy on the host. Try another browser or network.`;
          }
          setError(msg);
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return (
    <div className="public-view">
      <header className="public-view__bar">
        <span className="public-view__brand">Gcalidraw</span>
        <span className="public-view__badge">View only · no sign-in</span>
        <div className="public-view__bar-actions">
          <a
            className="btn btn--ghost btn--sm"
            href={getDriveFileViewUrl(fileId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Drive
          </a>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onOpenEditor}
          >
            Edit (sign in)
          </button>
        </div>
      </header>
      <div className="public-view__canvas">
        {phase === "loading" ? (
          <div className="public-view__center" role="status">
            <span className="public-view__spinner" aria-hidden="true" />
            <p className="public-view__msg">Loading diagram…</p>
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="public-view__center public-view__center--error">
            <p className="public-view__err-title">Could not load this view</p>
            <p className="public-view__err-body">{error}</p>
            <p className="public-view__err-hint">
              The file must be shared with <strong>Anyone with the link can view</strong>.
              You can still try{" "}
              <a href={getDriveFileViewUrl(fileId)}>Open in Drive</a>.
            </p>
          </div>
        ) : null}
        {phase === "ready" && scene ? (
          <Excalidraw
            initialData={{
              elements: scene.elements,
              appState: {
                ...scene.appState,
                viewModeEnabled: true,
              },
              files: scene.files,
            }}
            viewModeEnabled
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
              },
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
