import { useEffect, useRef } from "react";

function elementFromEventTarget(node) {
  if (!node) return null;
  if (node.nodeType === 3 && node.parentElement) return node.parentElement;
  return node instanceof Element ? node : null;
}

function isEditableTarget(node) {
  const el = elementFromEventTarget(node);
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

/**
 * Global shortcuts (capture phase). Keeps latest handlers in a ref.
 * @param {() => {
 *   signedIn: boolean;
 *   booting: boolean;
 *   savingDisabled: boolean;
 *   fileManagerOpen: boolean;
 *   shortcutsOpen: boolean;
 *   versionHistoryOpen: boolean;
 *   hasFolder: boolean;
 *   hasActiveFile: boolean;
 * }} getState
 * @param {{
 *   onSave: () => void | Promise<void>;
 *   onOpenFiles: () => void;
 *   onOpenFileSearch: () => void;
 *   onNewDiagram: () => void;
 *   onRenameCurrent: () => void;
 *   onCloseFileManager: () => void;
 *   onOpenShortcuts: () => void;
 *   onCloseShortcuts: () => void;
 *   onCloseVersionHistory: () => void;
 * }} actions
 */
export function useKeyboardShortcuts(getState, actions) {
  const getStateRef = useRef(getState);
  const actionsRef = useRef(actions);
  getStateRef.current = getState;
  actionsRef.current = actions;

  useEffect(() => {
    const onKeyDown = (e) => {
      const s = getStateRef.current();
      const a = actionsRef.current;

      if (s.shortcutsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          a.onCloseShortcuts();
        }
        return;
      }

      if (s.versionHistoryOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          a.onCloseVersionHistory();
        }
        return;
      }

      if (e.key === "Escape" && s.fileManagerOpen) {
        e.preventDefault();
        a.onCloseFileManager();
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.shiftKey && (e.code === "Slash" || e.key === "?")) {
        e.preventDefault();
        e.stopPropagation();
        a.onOpenShortcuts();
        return;
      }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const typing = isEditableTarget(e.target);

      if (key === "s") {
        if (!s.signedIn || s.booting || s.savingDisabled) return;
        e.preventDefault();
        e.stopPropagation();
        void a.onSave();
        return;
      }

      if (typing) return;

      if (key === "o") {
        if (!s.signedIn || s.booting) return;
        e.preventDefault();
        e.stopPropagation();
        a.onOpenFiles();
        return;
      }

      if (key === "k") {
        if (!s.signedIn || s.booting) return;
        e.preventDefault();
        e.stopPropagation();
        a.onOpenFileSearch();
        return;
      }

      if (key === "n") {
        if (!s.signedIn || s.booting || !s.hasFolder) return;
        e.preventDefault();
        e.stopPropagation();
        a.onNewDiagram();
        return;
      }

      if (key === "e") {
        if (!s.signedIn || s.booting || !s.hasActiveFile) return;
        e.preventDefault();
        e.stopPropagation();
        a.onRenameCurrent();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
