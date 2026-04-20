import { useCallback, useEffect, useState } from "react";
import { listDriveRevisions } from "../driveService.js";

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

export function VersionHistory({
  open,
  onClose,
  fileId,
  fileName,
  onRestoreRevision,
}) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listDriveRevisions(fileId);
      setRevisions(list);
    } catch (e) {
      setError(e?.message || String(e));
      setRevisions([]);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  return (
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
              Each save to Drive keeps a snapshot you can restore.
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
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={Boolean(restoringId)}
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
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && revisions.length === 0 ? (
          <p className="version-history__empty" role="status">
            No revisions found yet. Save the file once or twice, then open this
            panel again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
