import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounced upload of serialized scene; also exposes immediate save.
 * @param {{
 *   intervalMs: number;
 *   enabled: boolean;
 *   getSerialized: () => string;
 *   lastSavedSerializedRef: React.MutableRefObject<string | null>;
 *   save: (serialized: string) => Promise<void>;
 * }} opts
 */
export function useAutoSave({
  intervalMs,
  enabled,
  getSerialized,
  lastSavedSerializedRef,
  save,
}) {
  const [status, setStatus] = useState("idle");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isDirty = useCallback(() => {
    const cur = getSerialized();
    return cur !== lastSavedSerializedRef.current;
  }, [getSerialized, lastSavedSerializedRef]);

  const runSave = useCallback(async () => {
    if (!enabled) return;
    if (!isDirty()) return;
    setStatus("saving");
    try {
      const payload = getSerialized();
      await save(payload);
      lastSavedSerializedRef.current = payload;
      setStatus("saved");
      setLastSavedAt(new Date());
    } catch (e) {
      console.error(e);
      setStatus("error");
      throw e;
    }
  }, [enabled, getSerialized, isDirty, lastSavedSerializedRef, save]);

  const schedule = useCallback(() => {
    clearTimer();
    if (!enabled) return;
    timerRef.current = setTimeout(() => {
      runSave().catch(() => {});
    }, intervalMs);
  }, [clearTimer, enabled, intervalMs, runSave]);

  const bump = useCallback(() => {
    if (!enabled) return;
    schedule();
  }, [enabled, schedule]);

  const saveNow = useCallback(async () => {
    clearTimer();
    await runSave();
  }, [clearTimer, runSave]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) clearTimer();
  }, [enabled, clearTimer]);

  return { status, lastSavedAt, bump, saveNow, setStatus, isDirty };
}
