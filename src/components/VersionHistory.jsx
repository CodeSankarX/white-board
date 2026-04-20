import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  downloadAnyRevisionText,
  downloadDriveFileBlob,
  getDriveFileViewUrl,
  listDiagramSnapshots,
  listDriveRevisions,
} from "../driveService.js";

function formatRevTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

/**
 * Load snapshot bytes with OAuth (same as .excalidraw download). Drive
 * thumbnailLink/iconLink URLs are unreliable in <img> (cookies / CORS).
 */
function SnapshotThumb({ fileId }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let url;
    let cancelled = false;
    setState("loading");
    setBlobUrl(null);
    downloadDriveFileBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob || blob.size < 8) {
          setState("err");
          return;
        }
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("err");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);

  if (state === "loading") {
    return (
      <div
        className="version-history__snap-thumb version-history__snap-thumb--loading"
        role="status"
        aria-label="Loading preview"
      >
        <span className="file-manager__spinner" aria-hidden="true" />
      </div>
    );
  }

  if (state === "ok" && blobUrl) {
    return (
      <img
        className="version-history__snap-thumb"
        src={blobUrl}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        onError={() => {
          setBlobUrl((u) => {
            if (u) URL.revokeObjectURL(u);
            return null;
          });
          setState("err");
        }}
      />
    );
  }

  return (
    <div
      className="version-history__snap-thumb version-history__snap-thumb--na"
      role="img"
      aria-label="Preview is not available"
    >
      <span className="version-history__snap-na-text">
        Preview is not available
      </span>
    </div>
  );
}

export function VersionHistory({
  open,
  onClose,
  fileId,
  fileName,
  /** App "Excalidraw Drive" folder id (for listing PNG save snapshots). */
  excalidrawFolderId,
  onRestoreRevision,
  showToast,
  /** When true, parent should unmount the main Excalidraw (shared global editor store). */
  onRevisionPreviewActiveChange,
}) {
  const [revisions, setRevisions] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const revisionPreviewApiRef = useRef(null);

  const load = useCallback(async () => {
    if (!fileId) return;
    setRevisions([]);
    setSnapshots([]);
    setLoading(true);
    setError(null);
    try {
      const list = await listDriveRevisions(fileId);
      setRevisions(list);
    } catch (e) {
      setError(e?.message || String(e));
      setRevisions([]);
    }
    if (excalidrawFolderId) {
      try {
        const snaps = await listDiagramSnapshots(excalidrawFolderId, fileId);
        setSnapshots(snaps);
      } catch (e) {
        console.warn("listDiagramSnapshots", e);
        showToast?.(
          `Could not load save images: ${e?.message || String(e)}`.slice(
            0,
            220,
          ),
        );
        setSnapshots([]);
      }
    } else {
      setSnapshots([]);
    }
    setLoading(false);
  }, [fileId, excalidrawFolderId, showToast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      try {
        if (
          typeof document !== "undefined" &&
          document.activeElement instanceof HTMLElement
        ) {
          document.activeElement.blur();
        }
      } catch {
        /* ignore */
      }
      revisionPreviewApiRef.current = null;
      setPreview(null);
      setPreviewingId(null);
    }
  }, [open]);

  useEffect(() => {
    onRevisionPreviewActiveChange?.(Boolean(preview));
  }, [preview, onRevisionPreviewActiveChange]);

  const openPreview = useCallback(
    async (r) => {
      if (!fileId) return;
      setPreviewingId(r.id);
      try {
        const headId = revisions[0]?.id;
        const text = await downloadAnyRevisionText(fileId, r.id, headId);
        const trimmed = text.trim();
        if (!trimmed) {
          throw new Error("Drive returned an empty file for this revision.");
        }
        const forParse = trimmed.replace(/^\uFEFF/, "");
        if (
          forParse.startsWith("<") ||
          forParse.startsWith("<!") ||
          forParse.startsWith("<html")
        ) {
          throw new Error(
            "Drive returned HTML instead of diagram data. Check sign-in or try again.",
          );
        }
        const parsed = JSON.parse(forParse);
        const data = restore(parsed, null, null, { repairBindings: true });
        setPreview({
          revisionId: r.id,
          label: formatRevTime(r.modifiedTime),
          initialData: {
            elements: data.elements,
            appState: {
              ...data.appState,
              viewModeEnabled: true,
            },
            files: data.files,
            scrollToContent: true,
          },
        });
      } catch (e) {
        showToast?.(e?.message || "Could not load this revision for preview");
      } finally {
        setPreviewingId(null);
      }
    },
    [fileId, revisions, showToast],
  );

  const closePreview = useCallback(() => {
    try {
      if (
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
      ) {
        document.activeElement.blur();
      }
    } catch {
      /* ignore */
    }
    revisionPreviewApiRef.current = null;
    window.requestAnimationFrame(() => {
      setPreview(null);
    });
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePreview();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [preview, closePreview]);

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    const runScroll = (attempt) => {
      if (cancelled || attempt > 30) return;
      const api = revisionPreviewApiRef.current;
      if (!api) {
        requestAnimationFrame(() => runScroll(attempt + 1));
        return;
      }
      try {
        api.scrollToContent(api.getSceneElements(), {
          fitToViewport: true,
          animate: false,
        });
      } catch {
        /* ignore */
      }
    };
    const t = window.setTimeout(() => requestAnimationFrame(() => runScroll(0)), 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [preview?.revisionId]);

  if (!open) return null;

  const busy = Boolean(restoringId || previewingId);

  return (
    <>
      <div
        className="version-history-overlay"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="version-history"
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-history-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="version-history__header">
            <div>
              <h2 id="version-history-title">Version history</h2>
              <p className="version-history__sub">
                {fileName ? (
                  <>
                    <span className="version-history__fname">{fileName}</span>
                    {" · "}
                  </>
                ) : null}
                Each save to Drive keeps a snapshot you can preview or restore.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onClose}
              aria-label="Close"
            >
              Close
            </button>
          </div>
          {error ? (
            <p className="version-history__error" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="version-history__loading" role="status">
              <span className="file-manager__spinner" aria-hidden="true" />
              Loading revisions…
            </div>
          ) : (
            <ul className="version-history__list" aria-label="Drive revisions">
              {revisions.map((r, index) => (
                <li key={r.id} className="version-history__row">
                  <div className="version-history__meta">
                    <span className="version-history__time">
                      {formatRevTime(r.modifiedTime)}
                    </span>
                    {index === 0 ? (
                      <span className="version-history__badge">Newest</span>
                    ) : null}
                    {r.size ? (
                      <span className="version-history__size">
                        {(Number(r.size) / 1024).toFixed(1)} KB
                      </span>
                    ) : null}
                  </div>
                  <div className="version-history__row-actions">
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={busy}
                      aria-label={`Preview version from ${formatRevTime(r.modifiedTime)}`}
                      onClick={() => void openPreview(r)}
                    >
                      {previewingId === r.id ? "Loading…" : "Preview"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={busy}
                      aria-label={`Restore version from ${formatRevTime(r.modifiedTime)}`}
                      onClick={async () => {
                        setRestoringId(r.id);
                        try {
                          await onRestoreRevision(r.id);
                          onClose();
                        } catch {
                          /* parent shows toast */
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                    >
                      {restoringId === r.id ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && excalidrawFolderId ? (
            <div className="version-history__snapshots">
              <h3 className="version-history__snapshots-title">
                Save images (PNG)
              </h3>
              <p className="version-history__snapshots-hint">
                Each time this file is saved to Drive, a PNG is added under the
                subfolder <strong>Gcalidraw save images</strong> in your
                Excalidraw Drive folder. Up to 40 images per diagram are kept;
                older ones are moved to Drive trash.
              </p>
              {snapshots.length > 0 ? (
                <ul
                  className="version-history__snap-list"
                  aria-label="PNG snapshots for this diagram"
                >
                  {snapshots.map((s) => (
                    <li key={s.id} className="version-history__snap-row">
                      <SnapshotThumb fileId={s.id} />
                      <div className="version-history__snap-meta">
                        <span className="version-history__snap-time">
                          {formatRevTime(s.createdTime)}
                        </span>
                        <a
                          className="version-history__snap-link"
                          href={getDriveFileViewUrl(s.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in Drive
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="version-history__snapshots-empty" role="status">
                  No PNG snapshots yet. Save the diagram (auto-save or Save
                  now) to create the first image.
                </p>
              )}
            </div>
          ) : null}
          {!loading && !error && revisions.length === 0 ? (
            <p className="version-history__empty" role="status">
              No revisions found yet. Save the file once or twice, then open this
              panel again.
            </p>
          ) : null}
        </div>
      </div>
      {preview
        ? createPortal(
            <div
              className="revision-preview-overlay"
              role="presentation"
              onClick={closePreview}
            >
              <div
                className="revision-preview"
                role="dialog"
                aria-modal="true"
                aria-labelledby="revision-preview-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="revision-preview__header">
                  <h3 id="revision-preview-title" className="revision-preview__title">
                    Preview · {preview.label}
                  </h3>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={closePreview}
                    aria-label="Close preview"
                  >
                    Close
                  </button>
                </div>
                <p className="revision-preview__hint">
                  Read-only. Use <strong>Restore</strong> in version history to
                  replace the current file on Drive.
                </p>
                <div className="revision-preview__canvas">
                  <Excalidraw
                    key={preview.revisionId}
                    excalidrawAPI={(api) => {
                      revisionPreviewApiRef.current = api;
                    }}
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
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
