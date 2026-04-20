const LOGO_SRC = `${import.meta.env.BASE_URL}gcalidraw-logo.svg`;

export function Toolbar({
  signedIn,
  onSignIn,
  onSignOut,
  fileName,
  saveStatus,
  lastSavedAt,
  onSave,
  onOpenFiles,
  onNewDiagram,
  savingDisabled,
}) {
  const timeLabel =
    lastSavedAt instanceof Date
      ? lastSavedAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  let statusClass = "app-toolbar__pill";
  let statusText = "Ready";
  if (saveStatus === "saving") {
    statusText = "Saving…";
    statusClass += " app-toolbar__pill--busy";
  } else if (saveStatus === "saved" && timeLabel) {
    statusText = `Saved ${timeLabel}`;
    statusClass += " app-toolbar__pill--ok";
  } else if (saveStatus === "error") {
    statusText = "Save failed";
    statusClass += " app-toolbar__pill--err";
  }

  return (
    <header className="app-toolbar" role="banner">
      <div className="app-toolbar__brand">
        <div className="app-toolbar__mark">
          <img
            src={LOGO_SRC}
            alt=""
            width={36}
            height={36}
            decoding="async"
            fetchpriority="high"
          />
        </div>
        <div className="app-toolbar__brand-text">
          <span className="app-toolbar__title">Gcalidraw</span>
          <span className="app-toolbar__tagline">Whiteboard · Google Drive</span>
        </div>
      </div>
      <div className="app-toolbar__file" title={fileName || ""}>
        <span className="app-toolbar__file-label">Current file</span>
        <span className="app-toolbar__file-name">
          {fileName || "—"}
        </span>
      </div>
      <div className={statusClass} role="status" aria-live="polite">
        {statusText}
      </div>
      <div className="app-toolbar__actions">
        {signedIn ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onSave()}
              disabled={savingDisabled}
              aria-label="Save to Google Drive"
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onOpenFiles}
              aria-label="Open file manager"
            >
              Open
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onNewDiagram}
              aria-label="Create new diagram"
            >
              New
            </button>
            <button
              type="button"
              className="btn btn--muted"
              onClick={onSignOut}
              aria-label="Sign out"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--google"
            onClick={onSignIn}
            aria-label="Sign in with Google"
          >
            <span className="btn__google-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            </span>
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
}
