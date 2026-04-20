function modSymbol() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ? "⌘" : "Ctrl";
}

export function ShortcutsHelp({ open, onClose }) {
  if (!open) return null;
  const m = modSymbol();

  return (
    <div
      className="shortcuts-help-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="shortcuts-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-help__header">
          <h2 id="shortcuts-help-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <p className="shortcuts-help__hint">
          {m === "⌘" ? "⌘" : "Ctrl"} = {m === "⌘" ? "Command on Mac" : "Control on Windows / Linux"}
        </p>
        <table className="shortcuts-help__table">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Save to Google Drive</td>
              <td>
                <kbd className="shortcuts-help__kbd">{m}</kbd>{" "}
                <kbd className="shortcuts-help__kbd">S</kbd>
              </td>
            </tr>
            <tr>
              <td>Open diagram list</td>
              <td>
                <kbd className="shortcuts-help__kbd">{m}</kbd>{" "}
                <kbd className="shortcuts-help__kbd">O</kbd>
              </td>
            </tr>
            <tr>
              <td>New diagram</td>
              <td>
                <kbd className="shortcuts-help__kbd">{m}</kbd>{" "}
                <kbd className="shortcuts-help__kbd">N</kbd>
              </td>
            </tr>
            <tr>
              <td>Rename current diagram</td>
              <td>
                <kbd className="shortcuts-help__kbd">{m}</kbd>{" "}
                <kbd className="shortcuts-help__kbd">E</kbd>
              </td>
            </tr>
            <tr>
              <td>Show this panel</td>
              <td>
                <kbd className="shortcuts-help__kbd">{m}</kbd>{" "}
                <kbd className="shortcuts-help__kbd">Shift</kbd>{" "}
                <kbd className="shortcuts-help__kbd">/</kbd>
              </td>
            </tr>
            <tr>
              <td>Close file list or this panel</td>
              <td>
                <kbd className="shortcuts-help__kbd">Esc</kbd>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
