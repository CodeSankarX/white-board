import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagramPreviewThumb } from "./DiagramPreviewThumb.jsx";
import { FileDiagramFullscreenPreview } from "./FileDiagramFullscreenPreview.jsx";
import { TextInputModal } from "./TextInputModal.jsx";
import {
  getDriveFileViewUrl,
  listExcalidrawFiles,
  renameFile,
  trashFile,
} from "../driveService.js";

function formatModified(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

export function FileManager({
  open,
  onClose,
  folderId,
  activeFileId,
  onOpenFile,
  onDuplicateFile,
  onShareFile,
  focusSearchNonce = 0,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [renameTarget, setRenameTarget] = useState(null);
  const [fullscreenPreview, setFullscreenPreview] = useState(null);
  /** While a row action runs, avoid double-clicks and show inline progress. */
  const [rowBusy, setRowBusy] = useState(null);
  const searchInputRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listExcalidrawFiles(folderId);
      setFiles(list);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSortBy("recent");
      setRowBusy(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || loading || files.length === 0) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, loading, files.length]);

  useEffect(() => {
    if (!open || !focusSearchNonce || loading || files.length === 0) return;
    const id = requestAnimationFrame(() => {
      const el = searchInputRef.current;
      if (!el) return;
      el.focus();
      if (typeof el.select === "function") el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, focusSearchNonce, loading, files.length]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const displayedFiles = useMemo(() => {
    const list = [...filteredFiles];
    if (sortBy === "name") {
      list.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return list;
  }, [filteredFiles, sortBy]);

  const rowActionsLocked = rowBusy !== null;

  if (!open) return null;

  if (!folderId) {
    return (
      <div
        className="file-manager-overlay"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="file-manager"
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-manager-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="file-manager__header">
            <h2 id="file-manager-title">Your diagrams</h2>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onClose}
              aria-label="Close"
            >
              Close
            </button>
          </div>
          <p className="file-manager__empty">
            Sign in with Google in the toolbar to browse and open files from your
            Excalidraw Drive folder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="file-manager-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="file-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-manager__header">
          <h2 id="file-manager-title">Your diagrams</h2>
          <div className="file-manager__header-actions">
            {!loading && files.length > 0 ? (
              <>
                <label className="file-manager__sort">
                  <span className="gc-visually-hidden">Sort diagrams</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    aria-label="Sort diagrams"
                  >
                    <option value="recent">Recent first</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => refresh()}
                  aria-label="Refresh list from Drive"
                >
                  Refresh
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onClose}
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>
        {error && (
          <p className="file-manager__error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className="file-manager__loading" role="status">
            <span className="file-manager__spinner" aria-hidden="true" />
            Loading from Drive…
          </div>
        ) : (
          <>
            {files.length > 0 ? (
              <div className="file-manager__search">
                <label
                  className="file-manager__search-label"
                  htmlFor="file-manager-search"
                >
                  Search
                </label>
                <div className="file-manager__search-field">
                  <span className="file-manager__search-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM16.5 16.5L21 21"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <input
                    ref={searchInputRef}
                    id="file-manager-search"
                    type="search"
                    className="file-manager__search-input"
                    placeholder="Filter by file name…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-controls="file-manager-list"
                  />
                  {searchQuery.trim() ? (
                    <button
                      type="button"
                      className="file-manager__search-clear"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <ul
              id="file-manager-list"
              className="file-manager__list"
              aria-label="Diagram files"
            >
              {displayedFiles.map((f) => {
                const busyKind = (kind) =>
                  rowBusy?.id === f.id && rowBusy.kind === kind;
                return (
                <li key={f.id} className="file-manager__row">
                  <button
                    type="button"
                    className="file-manager__thumb-btn"
                    disabled={rowActionsLocked}
                    onClick={() =>
                      setFullscreenPreview({ id: f.id, name: f.name })
                    }
                    title="Fullscreen preview"
                    aria-label={`Fullscreen preview of ${f.name}`}
                  >
                    <DiagramPreviewThumb fileId={f.id} />
                  </button>
                  <div className="file-manager__row-content">
                    <div className="file-manager__name-block">
                      <span className="file-manager__name" title={f.name}>
                        {f.name}
                        {f.id === activeFileId ? " (current)" : ""}
                      </span>
                      {f.modifiedTime ? (
                        <span className="file-manager__meta">
                          {formatModified(f.modifiedTime)}
                        </span>
                      ) : null}
                    </div>
                    <span className="file-manager__actions">
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={rowActionsLocked}
                      onClick={() =>
                        setFullscreenPreview({ id: f.id, name: f.name })
                      }
                      aria-label={`Preview ${f.name} full screen`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={rowActionsLocked}
                      onClick={() => {
                        void (async () => {
                          setRowBusy({ id: f.id, kind: "open" });
                          try {
                            await onOpenFile(f);
                          } finally {
                            setRowBusy(null);
                          }
                        })();
                      }}
                      aria-label={`Open ${f.name}`}
                    >
                      {busyKind("open") ? "Opening…" : "Open"}
                    </button>
                    {onDuplicateFile ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={rowActionsLocked}
                        onClick={async () => {
                          setRowBusy({ id: f.id, kind: "duplicate" });
                          try {
                            await onDuplicateFile(f);
                            await refresh();
                          } catch (err) {
                            window.alert(err?.message || String(err));
                          } finally {
                            setRowBusy(null);
                          }
                        }}
                        aria-label={`Duplicate ${f.name}`}
                      >
                        {busyKind("duplicate") ? "Duplicating…" : "Duplicate"}
                      </button>
                    ) : null}
                    <a
                      className="btn btn--sm btn--ghost file-manager__drive-link"
                      href={getDriveFileViewUrl(f.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${f.name} in Google Drive`}
                    >
                      Drive
                    </a>
                    {onShareFile ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={rowActionsLocked}
                        onClick={() => onShareFile(f)}
                        aria-label={`Share ${f.name}`}
                      >
                        Share
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={rowActionsLocked}
                      onClick={() => setRenameTarget({ id: f.id, name: f.name })}
                      aria-label={`Rename ${f.name}`}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      disabled={rowActionsLocked}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Move "${f.name}" to Drive trash? You can restore it from Google Drive.`,
                          )
                        ) {
                          return;
                        }
                        setRowBusy({ id: f.id, kind: "delete" });
                        try {
                          await trashFile(f.id);
                          await refresh();
                          if (f.id === activeFileId) {
                            window.alert(
                              "The open file was deleted. Close this dialog and use Open or refresh the page.",
                            );
                          }
                        } catch (err) {
                          window.alert(err?.message || String(err));
                        } finally {
                          setRowBusy(null);
                        }
                      }}
                      aria-label={`Delete ${f.name}`}
                    >
                      {busyKind("delete") ? "Deleting…" : "Delete"}
                    </button>
                  </span>
                  </div>
                </li>
                );
              })}
            </ul>
            {!loading && files.length > 0 && filteredFiles.length === 0 ? (
              <p className="file-manager__empty" role="status">
                {`No diagrams match "${searchQuery.trim()}".`}
              </p>
            ) : null}
          </>
        )}
        {!loading && files.length === 0 && !error && (
          <p className="file-manager__empty">No diagrams yet.</p>
        )}
      </div>
      <FileDiagramFullscreenPreview
        open={Boolean(fullscreenPreview)}
        fileId={fullscreenPreview?.id ?? null}
        fileName={fullscreenPreview?.name ?? ""}
        onClose={() => setFullscreenPreview(null)}
        onOpenToEdit={async () => {
          const target = fullscreenPreview;
          if (!target) return;
          const opened = await onOpenFile(target);
          if (opened) setFullscreenPreview(null);
        }}
      />
      <TextInputModal
        open={Boolean(renameTarget)}
        title="Rename diagram"
        label="File name"
        initialValue={renameTarget?.name ?? ""}
        confirmLabel="Rename"
        cancelLabel="Cancel"
        helperText="Include .excalidraw or it will be added for you."
        onClose={() => setRenameTarget(null)}
        onConfirm={async (next) => {
          if (!renameTarget) return;
          const trimmed = next.trim();
          if (!trimmed || trimmed === renameTarget.name) {
            setRenameTarget(null);
            return;
          }
          try {
            await renameFile(renameTarget.id, trimmed);
            await refresh();
            setRenameTarget(null);
          } catch (err) {
            window.alert(err?.message || String(err));
            throw err;
          }
        }}
      />
    </div>
  );
}
