import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteFilePermission,
  enableAnyoneLinkReader,
  getDriveFileViewUrl,
  listFilePermissions,
  shareFileWithEmail,
} from "../driveService.js";
import { buildPublicSketchShareUrl } from "../shareLink.js";

function parseEmailList(raw) {
  const parts = raw.split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function ShareDialog({ open, fileId, fileName, onClose, showToast }) {
  const titleId = useId();
  const linkInputRef = useRef(null);
  const appLinkInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [anyonePermId, setAnyonePermId] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  const viewUrl = fileId ? getDriveFileViewUrl(fileId) : "";
  const appViewUrl = fileId ? buildPublicSketchShareUrl(fileId) : "";

  const refreshPermissions = useCallback(async () => {
    if (!fileId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const perms = await listFilePermissions(fileId);
      const anyone = perms.find((p) => p.type === "anyone");
      setAnyonePermId(anyone?.id ?? null);
    } catch (e) {
      setLoadError(e?.message || String(e));
      setAnyonePermId(null);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (!open || !fileId) return;
    void refreshPermissions();
  }, [open, fileId, refreshPermissions]);

  useEffect(() => {
    if (!open) {
      setEmailsRaw("");
      setLoadError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(viewUrl);
      showToast?.("Link copied");
    } catch {
      try {
        linkInputRef.current?.select();
        document.execCommand("copy");
        showToast?.("Link copied");
      } catch {
        showToast?.("Could not copy — select the link and copy manually");
      }
    }
  }, [viewUrl, showToast]);

  const copyAppLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(appViewUrl);
      showToast?.("Gcalidraw link copied");
    } catch {
      try {
        appLinkInputRef.current?.select();
        document.execCommand("copy");
        showToast?.("Gcalidraw link copied");
      } catch {
        showToast?.("Could not copy — select the link and copy manually");
      }
    }
  }, [appViewUrl, showToast]);

  const toggleAnyoneLink = useCallback(
    async (enabled) => {
      if (!fileId || linkBusy) return;
      setLinkBusy(true);
      try {
        if (enabled) {
          const id = await enableAnyoneLinkReader(fileId);
          setAnyonePermId(id);
          showToast?.("Anyone with the link can view this file in Drive");
        } else {
          const perms = await listFilePermissions(fileId);
          const anyone = perms.find((p) => p.type === "anyone");
          if (anyone?.id) {
            await deleteFilePermission(fileId, anyone.id);
            showToast?.("Link sharing turned off");
          }
          setAnyonePermId(null);
        }
        await refreshPermissions();
      } catch (e) {
        showToast?.(e?.message || "Could not update link sharing");
        await refreshPermissions().catch(() => {});
      } finally {
        setLinkBusy(false);
      }
    },
    [fileId, linkBusy, refreshPermissions, showToast],
  );

  const invite = useCallback(async () => {
    if (!fileId || inviteBusy) return;
    const emails = parseEmailList(emailsRaw);
    if (emails.length === 0) {
      showToast?.("Enter at least one email address");
      return;
    }
    setInviteBusy(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const email of emails) {
        try {
          await shareFileWithEmail(fileId, email, {
            sendNotificationEmail: true,
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      if (ok > 0) {
        showToast?.(
          fail > 0
            ? `Invited ${ok} address(es); ${fail} failed (may already have access)`
            : `Invited ${ok} address(es) as viewers`,
        );
        setEmailsRaw("");
      } else {
        showToast?.(
          "Could not add those addresses (check emails or permissions)",
        );
      }
    } finally {
      setInviteBusy(false);
    }
  }, [fileId, emailsRaw, inviteBusy, showToast]);

  if (!open || !fileId) return null;

  const linkOn = Boolean(anyonePermId);

  return createPortal(
    <div
      className="share-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share-dialog__header">
          <h2 id={titleId} className="share-dialog__title">
            Share
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <p className="share-dialog__file" title={fileName || ""}>
          {fileName || "Untitled"}
        </p>

        {loadError ? (
          <p className="share-dialog__error" role="alert">
            {loadError}
          </p>
        ) : null}

        <section
          className="share-dialog__section"
          aria-labelledby={`${titleId}-app`}
        >
          <h3 id={`${titleId}-app`} className="share-dialog__section-title">
            View on this site (no sign-in)
          </h3>
          <p className="share-dialog__hint">
            Opens Gcalidraw in <strong>read-only</strong> mode without Google
            sign-in. Turn on <strong>Anyone with the link</strong> below. An
            optional <code className="share-dialog__code">VITE_GOOGLE_API_KEY</code>{" "}
            loads the file directly from Google; without it, a public CORS relay
            is used (less private; see README).
          </p>
          <div className="share-dialog__field-row">
            <input
              ref={appLinkInputRef}
              type="text"
              readOnly
              className="share-dialog__input share-dialog__input--mono"
              value={appViewUrl}
              spellCheck={false}
              aria-label="Link to view on Gcalidraw without sign-in"
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void copyAppLink()}
            >
              Copy
            </button>
          </div>
          <label className="share-dialog__check">
            <input
              type="checkbox"
              checked={linkOn}
              disabled={loading || linkBusy}
              onChange={(e) => void toggleAnyoneLink(e.target.checked)}
            />
            <span>Anyone with the link can view (required for the link above)</span>
          </label>
          {linkBusy ? (
            <p className="share-dialog__status" role="status">
              Updating…
            </p>
          ) : null}
        </section>

        <section className="share-dialog__section" aria-labelledby={`${titleId}-link`}>
          <h3 id={`${titleId}-link`} className="share-dialog__section-title">
            View in Google Drive
          </h3>
          <p className="share-dialog__hint">
            Opens the raw{" "}
            <code className="share-dialog__code">.excalidraw</code> file in Drive
            (download / preview there).
          </p>
          <div className="share-dialog__field-row">
            <input
              ref={linkInputRef}
              type="text"
              readOnly
              className="share-dialog__input share-dialog__input--mono"
              value={viewUrl}
              spellCheck={false}
              aria-label="Shareable Drive link"
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void copyLink()}
            >
              Copy
            </button>
          </div>
        </section>

        <section
          className="share-dialog__section"
          aria-labelledby={`${titleId}-invite`}
        >
          <h3 id={`${titleId}-invite`} className="share-dialog__section-title">
            Invite by email
          </h3>
          <p className="share-dialog__hint">
            Adds each address as a <strong>viewer</strong> on this file in
            Drive. Google sends a notification when possible.
          </p>
          <textarea
            className="share-dialog__textarea"
            rows={3}
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            placeholder="friend@example.com, teammate@company.org"
            spellCheck={false}
            disabled={inviteBusy}
            aria-label="Email addresses to invite"
          />
          <div className="share-dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void invite()}
              disabled={inviteBusy || loading}
            >
              {inviteBusy ? "Sending…" : "Invite viewers"}
            </button>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
