import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { downloadFileText } from "../driveService.js";

/**
 * Full-screen read-only Excalidraw preview for a Drive file (e.g. from file manager search).
 * Caller provides onOpenToEdit to load the file into the main editor.
 */
export function FileDiagramFullscreenPreview({
  open,
  fileId,
  fileName,
  onClose,
  onOpenToEdit,
}) {
  const [phase, setPhase] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [openingToEdit, setOpeningToEdit] = useState(false);

  useEffect(() => {
    if (!open || !fileId) {
      setPhase("idle");
      setPreview(null);
      setLoadError(null);
      setOpeningToEdit(false);
      return undefined;
    }

    let cancelled = false;
    setPhase("loading");
    setPreview(null);
    setLoadError(null);

    (async () => {
      try {
        const text = await downloadFileText(fileId);
        const trimmed = text.trim().replace(/^\uFEFF/, "");
        if (!trimmed) {
          throw new Error("Empty file from Drive.");
        }
        if (trimmed.startsWith("<")) {
          throw new Error("Drive returned HTML instead of diagram data.");
        }
        const parsed = JSON.parse(trimmed);
        const data = restore(parsed, null, null, { repairBindings: true });
        if (cancelled) return;
        setPreview({
          initialData: {
            elements: data.elements,
            appState: {
              ...data.appState,
              viewModeEnabled: true,
            },
            files: data.files,
          },
        });
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setLoadError(e?.message || String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, fileId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || !fileId) return null;

  const title = fileName?.trim() || "Diagram";

  return createPortal(
    <div
      className="file-diagram-fullscreen-preview-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="file-diagram-fullscreen-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-diagram-fullscreen-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="file-diagram-fullscreen-preview__bar">
          <div className="file-diagram-fullscreen-preview__bar-text">
            <h2
              id="file-diagram-fullscreen-preview-title"
              className="file-diagram-fullscreen-preview__title"
            >
              Preview · {title}
            </h2>
            <p className="file-diagram-fullscreen-preview__hint">
              Read-only. Use <strong>Open to edit</strong> to load this file on
              the canvas.
            </p>
          </div>
          <div className="file-diagram-fullscreen-preview__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onClose}
              aria-label="Close preview"
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={phase !== "ready" || openingToEdit}
              onClick={() => {
                if (!onOpenToEdit) return;
                setOpeningToEdit(true);
                void Promise.resolve(onOpenToEdit()).finally(() =>
                  setOpeningToEdit(false),
                );
              }}
              aria-label={`Open ${title} in editor`}
              aria-busy={openingToEdit || undefined}
            >
              {openingToEdit ? "Opening…" : "Open to edit"}
            </button>
          </div>
        </header>
        <div className="file-diagram-fullscreen-preview__body">
          {phase === "loading" ? (
            <div className="file-diagram-fullscreen-preview__status" role="status">
              Loading diagram…
            </div>
          ) : null}
          {phase === "error" ? (
            <p className="file-diagram-fullscreen-preview__error" role="alert">
              {loadError || "Could not load preview."}
            </p>
          ) : null}
          {phase === "ready" && preview ? (
            <div className="file-diagram-fullscreen-preview__canvas">
              <Excalidraw
                key={fileId}
                viewModeEnabled
                initialData={preview.initialData}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                  },
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
