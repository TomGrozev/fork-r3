import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { ArtifactDocumentTarget } from "../../../shared/artifacts.ts";
import { ATTACHMENT_LIMITS } from "../../../shared/attachments.ts";
import { artifactDrafts } from "../artifact-drafts.ts";
import { prepareDraftImage } from "../attachment-drafts.ts";
import { canCapturePreview, capturePreview } from "../screenshot.ts";
import { Button } from "../ui.tsx";
import { ImageEditor } from "./ImageEditor.tsx";

export function PreviewScreenshot({
  artifactId,
  versionSeq,
  path,
  route,
  frame,
  onTarget,
}: {
  artifactId: string;
  versionSeq: number;
  path: string;
  route?: string;
  frame: RefObject<HTMLIFrameElement | null>;
  onTarget: (target: ArtifactDocumentTarget) => void;
}) {
  const [pending, setPending] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    blob: Blob;
    viewport: { width: number; height: number };
  } | null>(null);
  const [notice, setNotice] = useState("");
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const supported = canCapturePreview();
  const hintId = useId();
  const unavailableHint =
    "Area capture is unavailable in this browser. Paste or attach a screenshot, or try desktop Chrome.";
  useEffect(() => {
    const cancel = () => {
      generation.current++;
      operation.current?.abort();
      operation.current = null;
      setPending(false);
      setSnapshot(null);
    };
    const node = frame.current;
    node?.addEventListener("load", cancel);
    window.addEventListener("pagehide", cancel);
    return () => {
      node?.removeEventListener("load", cancel);
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [frame]);
  const begin = async () => {
    const node = frame.current;
    if (!node) return;
    if ((artifactDrafts.get(artifactId)?.attachments?.length ?? 0) >= ATTACHMENT_LIMITS.count) {
      setNotice("The draft already contains four images");
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setNotice("");
    const viewport = { width: node.clientWidth, height: node.clientHeight };
    // Hide detached r3 controls that would otherwise occlude the preview pixels.
    document.documentElement.dataset.r3Screenshot = "true";
    const timer = window.setTimeout(() => {
      controller.abort();
      if (operation.current === controller)
        setNotice("Capture timed out. Try again or paste a screenshot.");
    }, 60_000);
    try {
      const blob = await capturePreview(node, controller.signal);
      if (operation.current === controller && !controller.signal.aborted)
        setSnapshot({ blob, viewport });
    } catch (error) {
      if (operation.current === controller && !controller.signal.aborted)
        setNotice(
          error instanceof DOMException
            ? error.name === "NotAllowedError"
              ? "Capture cancelled. You can paste a screenshot instead."
              : "The browser could not capture this preview. Try again or paste a screenshot."
            : error instanceof Error
              ? error.message
              : "Unable to capture this preview. You can paste a screenshot instead.",
        );
    } finally {
      clearTimeout(timer);
      delete document.documentElement.dataset.r3Screenshot;
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
        <Button
          disabled={!supported || pending}
          title={supported ? "Share this tab, then select an area" : unavailableHint}
          aria-describedby={hintId}
          onClick={() => void begin()}
        >
          Capture area
        </Button>
        {pending ? (
          <>
            <span id={hintId}>Choose this r3 tab in the browser sharing prompt.</span>
            <Button
              onClick={() => {
                operation.current?.abort();
                delete document.documentElement.dataset.r3Screenshot;
                setPending(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : !supported ? (
          <span id={hintId}>{unavailableHint}</span>
        ) : (
          <span id={hintId}>Attach a screenshot to feedback</span>
        )}
        {notice && <span role="status">{notice}</span>}
      </div>
      {snapshot && (
        <ImageEditor
          blob={snapshot.blob}
          onCancel={() => {
            generation.current++;
            setSnapshot(null);
          }}
          onSave={async (blob, crop) => {
            const started = generation.current;
            if (
              (artifactDrafts.get(artifactId)?.attachments?.length ?? 0) >= ATTACHMENT_LIMITS.count
            )
              throw new Error("The draft already contains four images");
            const { attachment, persisted } = await prepareDraftImage(artifactId, blob, {
              versionSeq,
              path,
              ...(route ? { route } : {}),
              viewport: snapshot.viewport,
              crop,
            });
            if (started !== generation.current)
              throw new Error("The preview changed. Capture it again.");
            if (
              (artifactDrafts.get(artifactId)?.attachments?.length ?? 0) >= ATTACHMENT_LIMITS.count
            )
              throw new Error("The draft already contains four images");
            onTarget({ kind: "rendered", versionSeq, path, locator: null });
            const draft = artifactDrafts.get(artifactId);
            artifactDrafts.update(artifactId, {
              attachments: [...(draft?.attachments ?? []), attachment],
            });
            artifactDrafts.flush();
            setSnapshot(null);
            if (!persisted)
              setNotice("Screenshot is available in this tab, but could not be saved for reload.");
          }}
        />
      )}
    </>
  );
}
