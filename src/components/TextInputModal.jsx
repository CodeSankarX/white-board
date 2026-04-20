import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal for a single-line text action (same chrome as file list dialog).
 */
export function TextInputModal({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  helperText,
  onClose,
  onConfirm,
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setValue(initialValue ?? "");
    const frame = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (typeof el.select === "function") el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (submitting) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
    } catch {
      /* caller may show toast; keep modal open */
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="text-input-modal-overlay"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (!submitting) onClose();
      }}
    >
      <div
        className="text-input-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-input-modal__header">
          <h2 id={`${id}-title`} className="text-input-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <form
          className="text-input-modal__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="text-input-modal__label" htmlFor={inputId}>
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className="text-input-modal__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
          />
          {helperText ? (
            <p className="text-input-modal__helper">{helperText}</p>
          ) : null}
          <div className="text-input-modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={submitting}
            >
              {cancelLabel}
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? "Please wait…" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
