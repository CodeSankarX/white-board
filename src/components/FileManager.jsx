import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listExcalidrawFiles, renameFile, trashFile } from "../driveService.js";

export function FileManager({
  open,
  onClose,
  folderId,
  activeFileId,
  onOpenFile,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
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
    if (!open) setSearchQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || loading || files.length === 0) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, loading, files.length]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, searchQuery]);

  if (!open) return null;

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
            {filteredFiles.map((f) => (
              <li key={f.id} className="file-manager__row">
                <span className="file-manager__name">
                  {f.name}
                  {f.id === activeFileId ? " (current)" : ""}
                </span>
                <span className="file-manager__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => onOpenFile(f)}
                    aria-label={`Open ${f.name}`}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={async () => {
                      const next = window.prompt("Rename to", f.name);
                      if (!next || next === f.name) return;
                      try {
                        await renameFile(f.id, next);
                        await refresh();
                      } catch (err) {
                        window.alert(err?.message || String(err));
                      }
                    }}
                    aria-label={`Rename ${f.name}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Move "${f.name}" to Drive trash? You can restore it from Google Drive.`,
                        )
                      ) {
                        return;
                      }
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
                      }
                    }}
                    aria-label={`Delete ${f.name}`}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
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
    </div>
  );
}
