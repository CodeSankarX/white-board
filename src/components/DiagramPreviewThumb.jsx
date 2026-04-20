import { useEffect, useRef, useState } from "react";
import { exportToSvg, restore } from "@excalidraw/excalidraw";
import { downloadFileText } from "../driveService.js";

/**
 * Lazy-loads file JSON from Drive when the row is near the visible scroll area,
 * then renders a small SVG snapshot via Excalidraw export.
 */
export function DiagramPreviewThumb({ fileId }) {
  const [phase, setPhase] = useState("idle");
  const [src, setSrc] = useState(null);
  const sentinelRef = useRef(null);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    if (!fileId) return undefined;

    let cancelled = false;

    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    const buildPreview = async () => {
      setPhase("loading");
      try {
        const text = await downloadFileText(fileId);
        if (cancelled) return;
        const data = restore(JSON.parse(text), null, null, {
          repairBindings: true,
        });
        const svg = await exportToSvg({
          elements: data.elements,
          appState: {
            ...data.appState,
            exportBackground: true,
          },
          files: data.files,
          exportPadding: 12,
          skipInliningFonts: true,
        });
        if (cancelled) return;
        const str = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([str], {
          type: "image/svg+xml;charset=utf-8",
        });
        revoke();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setSrc(url);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    };

    const el = sentinelRef.current;
    if (!el) return undefined;

    const root = el.closest(".file-manager");

    if (!root) {
      void buildPreview();
      return () => {
        cancelled = true;
        revoke();
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        void buildPreview();
      },
      { root, rootMargin: "120px 0px", threshold: 0.01 },
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
      revoke();
    };
  }, [fileId]);

  return (
    <div
      ref={sentinelRef}
      className="file-manager__thumb"
      aria-hidden="true"
    >
      {phase === "loading" || phase === "idle" ? (
        <span className="file-manager__thumb-skel" />
      ) : null}
      {phase === "error" ? (
        <span className="file-manager__thumb-fallback" title="No preview">
          ◇
        </span>
      ) : null}
      {src ? (
        <img src={src} alt="" className="file-manager__thumb-img" decoding="async" />
      ) : null}
    </div>
  );
}
