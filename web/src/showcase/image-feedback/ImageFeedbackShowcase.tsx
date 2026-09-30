import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ATTACHMENT_LIMITS } from "../../../../shared/attachments.ts";
import { ImageEditor } from "../../components/ImageEditor.tsx";
import type { ImageCrop } from "../../image-edit.ts";
import {
  type ImageInsertion,
  imageMessageBody,
  insertImagePlaceholders,
} from "../../image-placeholders.ts";
import { PaperclipIcon, PencilIcon, TrashIcon } from "../../ui.tsx";
import { useTheme } from "../theme.ts";
import { sampleScreenshot } from "./sample.ts";
import "./showcase.css";

type DemoImage = {
  id: number;
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
  capture?: { version: number; crop: ImageCrop };
};
type Draft = { text: string; images: DemoImage[]; version: number };
type Note = Draft & { id: number; replyTo?: number };
type Edit = {
  blob: Blob;
  name: string;
  replace?: number;
  captureVersion?: number;
  previousCrop?: ImageCrop;
};
const blank = (version = 3): Draft => ({ text: "", images: [], version });
const command = "r3 feedback fetch artifact_example --attachments-dir ./feedback-images";

function Overlay({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      className="image-showcase-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Close dialog">
          ✕
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}

export function ImageFeedbackShowcase() {
  const [dark, toggleTheme] = useTheme();
  const [sample, setSample] = useState<DemoImage | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [notes, setNotes] = useState<Note[]>([]);
  const [version, setVersion] = useState(3);
  const [replyTo, setReplyTo] = useState<number>();
  const [editing, setEditing] = useState<Edit | null>(null);
  const [viewer, setViewer] = useState<DemoImage | null>(null);
  const [capture, setCapture] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Try the sample, or attach an image of your own.");
  const [failNext, setFailNext] = useState(false);
  const [recovery, setRecovery] = useState<{ draft: Draft; replyTo?: number } | null>(null);
  const [handoff, setHandoff] = useState(0);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const urls = useRef(new Set<string>());
  const serial = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const current = useRef(draft);
  current.current = draft;
  const hasDraft = !!draft.text.trim() || draft.images.length > 0;
  const full = draft.images.length >= ATTACHMENT_LIMITS.count;

  const image = useCallback(async (blob: Blob, name: string): Promise<DemoImage> => {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > ATTACHMENT_LIMITS.pixels)
        throw new Error("Images must be at most 20 megapixels.");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      const normalized = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("Unable to prepare image."))),
          "image/png",
        ),
      );
      if (normalized.size > ATTACHMENT_LIMITS.bytes)
        throw new Error("The prepared image exceeds 5 MiB. Choose a smaller image.");
      const url = URL.createObjectURL(normalized);
      urls.current.add(url);
      return {
        id: ++serial.current,
        blob: normalized,
        url,
        name,
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      bitmap.close();
    }
  }, []);

  useEffect(() => {
    let active = true;
    const held = urls.current;
    void sampleScreenshot()
      .then((blob) => image(blob, "studio-overview.png"))
      .then((value) => {
        if (active) setSample(value);
        else {
          URL.revokeObjectURL(value.url);
          held.delete(value.url);
        }
      })
      .catch(() => {
        if (active) setError("Unable to create the sample image. You can still attach your own.");
      });
    return () => {
      active = false;
      for (const url of held) URL.revokeObjectURL(url);
      held.clear();
    };
  }, [image]);

  const focusComposer = () => {
    document
      .getElementById("feedback-playground")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const selection = (text = ""): ImageInsertion => ({
    start: textarea.current?.selectionStart ?? current.current.text.length,
    end: textarea.current?.selectionEnd ?? current.current.text.length,
    text,
  });
  function appendImages(added: DemoImage[], insertion: ImageInsertion) {
    const value = current.current;
    const result = insertImagePlaceholders(
      value.text,
      value.images.length + 1,
      added.length,
      insertion,
    );
    flushSync(() => {
      setDraft({ ...value, text: result.body, images: [...value.images, ...added] });
      setBusy(false);
    });
    textarea.current?.focus({ preventScroll: true });
    textarea.current?.setSelectionRange(result.caret, result.caret);
  }
  async function attach(files: File[], text = "") {
    if (loading.current || recovery) return;
    if (!files.length) return;
    const insertion = selection(text);
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      if (files.length + current.current.images.length > ATTACHMENT_LIMITS.count)
        throw new Error("Up to 4 images per message. Remove one before attaching more.");
      const added: DemoImage[] = [];
      for (const file of files) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error("Choose a PNG, JPEG, or WebP image.");
        if (file.size > ATTACHMENT_LIMITS.bytes) throw new Error("Images must be at most 5 MiB.");
        added.push(await image(file, file.name || "pasted-image.png"));
      }
      appendImages(added, insertion);
      setNotice("Image attached. Open Edit to crop it or add a drawing.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open this image.");
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }
  function addSample() {
    if (!sample || full || recovery || busy) return;
    appendImages([{ ...sample, id: ++serial.current }], selection());
    setError("");
    setNotice("Sample attached. You can post an image without writing any text.");
  }
  async function saveEdit(blob: Blob, crop: ImageCrop) {
    if (!editing) return;
    const result = await image(blob, editing.name);
    if (editing.captureVersion !== undefined)
      result.capture = {
        version: editing.captureVersion,
        crop: {
          ...crop,
          x: (editing.previousCrop?.x ?? 0) + crop.x,
          y: (editing.previousCrop?.y ?? 0) + crop.y,
        },
      };
    setDraft((value) => {
      const images =
        editing.replace === undefined
          ? [...value.images, result]
          : value.images.map((item) => (item.id === editing.replace ? result : item));
      return { ...value, images, text: imageMessageBody(value.text, value.images, images) };
    });
    setEditing(null);
    setError("");
    setNotice("Image ready. Cropping and drawings are baked into the attached PNG.");
  }
  function post() {
    if (!hasDraft || busy || recovery) return;
    if (failNext) {
      setFailNext(false);
      setError("Simulated save failure. Your text and images are still here. Try posting again.");
      return;
    }
    setNotes((value) => [...value, { ...draft, id: ++serial.current, replyTo }]);
    setDraft(blank(version));
    setReplyTo(undefined);
    setError("");
    setHandoff(0);
    setNotice("Posted in the playground. Open an image, or add an image reply below.");
  }
  function recoverDemo() {
    if (recovery || busy || !sample) return;
    const saved = hasDraft
      ? draft
      : {
          text: "Give the September label a little more space. [image1] ",
          images: [{ ...sample, id: ++serial.current }],
          version,
        };
    setRecovery({ draft: saved, replyTo });
    setDraft(blank(version));
    setError("");
    setNotice("Simulated navigation away. Restore the saved example to continue.");
    focusComposer();
  }
  const reset = () => {
    setDraft(blank());
    setNotes([]);
    setVersion(3);
    setReplyTo(undefined);
    setRecovery(null);
    setError("");
    setFailNext(false);
    setHandoff(0);
    setNotice("Playground reset. Start with a sample or your own image.");
  };

  return (
    <main className="image-showcase">
      <div className="showcase-shell">
        <header className="showcase-masthead" id="showcase-top">
          <a
            href="#showcase-top"
            className="showcase-brand"
            aria-label="r3 image feedback playground"
          >
            <span>r3</span>
            <span className="showcase-divider" />
            Interaction lab
          </a>
          <div className="showcase-actions">
            <span className="showcase-chip">Image feedback + drawing</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? "Light" : "Dark"} mode
            </button>
          </div>
        </header>

        <section className="showcase-hero" id="feature-introduction">
          <div>
            <p className="showcase-eyebrow">LESS EXPLAINING. MORE SHOWING.</p>
            <h1>
              Feedback, with
              <br />
              the full picture<span>.</span>
            </h1>
          </div>
          <div className="showcase-hero-copy">
            <p>
              Capture the detail. Draw attention to it.
              <br />
              Keep the image with the conversation.
            </p>
            <p className="showcase-muted">
              Try the real image editor below. Posting, recovery, and delivery are local
              walkthroughs; nothing is sent to an agent.
            </p>
            <button
              type="button"
              className="showcase-primary"
              disabled={!sample || full || !!recovery || busy}
              onClick={() => {
                if (sample) setEditing({ blob: sample.blob, name: "annotated-overview.png" });
              }}
            >
              Try the drawing tools <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>

        <nav className="showcase-steps" aria-label="Feature tour">
          <a href="#feedback-playground">
            <span>01</span> Capture & mark up
          </a>
          <a href="#recovery-scenarios">
            <span>02</span> Recover & retry
          </a>
          <a href="#agent-handoff">
            <span>03</span> Deliver to an agent
          </a>
        </nav>

        <section
          id="feedback-playground"
          className="showcase-workspace"
          aria-label="Interactive image feedback playground"
        >
          <header className="showcase-section-header">
            <div>
              <span className="showcase-live-dot" />
              <strong>The playground</strong>
              <span className="showcase-muted">Session only</span>
            </div>
            <button type="button" onClick={reset} disabled={busy}>
              Reset demo
            </button>
          </header>
          <div className="showcase-workspace-grid">
            <section className="showcase-preview" aria-label="Example HTML artifact">
              <div className="showcase-preview-actions">
                <button
                  type="button"
                  id="capture-walkthrough"
                  disabled={!sample || full || !!recovery || busy}
                  onClick={() => setCapture(true)}
                >
                  Capture walkthrough
                </button>
                <button
                  type="button"
                  id="attach-sample"
                  disabled={!sample || full || !!recovery || busy}
                  onClick={addSample}
                >
                  Attach sample image
                </button>
              </div>
              <div className="showcase-preview-bar">
                <span>Studio / overview</span>
                <span className="showcase-mono">HTML · v{version}</span>
              </div>
              <div className="showcase-sample">
                {sample ? (
                  <img
                    src={sample.url}
                    width={1200}
                    height={760}
                    alt="Sample Studio dashboard. The September bar value overlaps the Best month yet callout."
                  />
                ) : (
                  <p>Preparing sample…</p>
                )}
              </div>
              <div className="showcase-preview-caption">
                <span className="showcase-index">↗</span>
                <p>
                  <strong>Something is off in September.</strong>
                  <br />
                  <span className="showcase-muted">
                    Capture the chart, crop the detail, then point to the overlap.
                  </span>
                </p>
              </div>
              <p className="showcase-footnote">
                To capture this page for real, use the <strong>Capture area</strong> camera icon
                beside Comment mode in the r3 navbar. The icon is hidden when your browser does not
                support capture; paste or attach a screenshot instead.
              </p>
            </section>

            <section className="showcase-conversation" aria-label="Demo feedback panel">
              <div className="showcase-panel-title">
                <h2>Feedback</h2>
                <span className="showcase-chip">
                  {notes.filter((note) => !note.replyTo).length} notes
                </span>
              </div>
              {notes.length > 0 && (
                <section className="showcase-notes" aria-label="Posted demo messages">
                  {notes.map((note, index) => (
                    <article
                      className={`showcase-note ${note.replyTo ? "showcase-reply" : ""}`}
                      key={note.id}
                      id={`demo-message-${note.id}`}
                    >
                      <header>
                        <strong>{note.replyTo ? "You · reply" : `You · note ${index + 1}`}</strong>
                        <span>v{note.version} · pending</span>
                      </header>
                      {note.text && <p>{note.text}</p>}
                      <div className="showcase-posted-images">
                        {note.images.map((item, imageIndex) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => setViewer(item)}
                            aria-label={`Open ${item.name}`}
                          >
                            <img src={item.url} alt={item.name} />
                            <span>{`[image${imageIndex + 1}]`}</span>
                          </button>
                        ))}
                      </div>
                      {!note.replyTo && (
                        <button
                          type="button"
                          className="showcase-text-button"
                          disabled={hasDraft || !!recovery || busy}
                          onClick={() => {
                            setReplyTo(note.id);
                            setDraft(blank(version));
                            setNotice("Replying to this note. Try an image-only reply.");
                          }}
                        >
                          Reply with an image
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              )}
              <div className="showcase-composer" id="demo-composer">
                <div className="showcase-context">
                  <span>
                    {replyTo ? "Reply" : "New note"} · <strong>v{draft.version}</strong> ·
                    index.html
                  </span>
                  <span>Rendered</span>
                </div>
                {recovery ? (
                  <div className="showcase-recovery" role="status">
                    <span className="showcase-index">↶</span>
                    <h3>Your draft is waiting.</h3>
                    <p>
                      {recovery.draft.images.length} image(s) and your text, still attached to v
                      {recovery.draft.version}.
                    </p>
                    <button
                      type="button"
                      className="showcase-primary"
                      id="restore-draft"
                      onClick={() => {
                        setDraft(recovery.draft);
                        setReplyTo(recovery.replyTo);
                        setRecovery(null);
                        setNotice("Demo draft restored with its original version and images.");
                      }}
                    >
                      Restore demo draft
                    </button>
                    <small>
                      This simulates recovery. The real workspace persists drafts across reloads;
                      this playground resets on reload.
                    </small>
                  </div>
                ) : (
                  <>
                    <textarea
                      ref={textarea}
                      disabled={busy}
                      id="demo-feedback-text"
                      aria-label="Demo feedback text"
                      value={draft.text}
                      placeholder="Describe the detail… or just attach an image."
                      onChange={(event) =>
                        setDraft((value) => ({ ...value, text: event.target.value }))
                      }
                      onPaste={(event) => {
                        const files = [...event.clipboardData.items]
                          .filter((item) => item.kind === "file")
                          .map((item) => item.getAsFile())
                          .filter((file): file is File => !!file);
                        if (files.length) {
                          event.preventDefault();
                          void attach(files, event.clipboardData.getData("text/plain"));
                        }
                      }}
                    />
                    <div className="showcase-draft-images">
                      {draft.images.map((item, index) => (
                        <article key={item.id}>
                          <small>{`[image${index + 1}]`}</small>
                          <button
                            type="button"
                            className="showcase-thumbnail"
                            onClick={() => setViewer(item)}
                            aria-label={`Preview ${item.name}`}
                          >
                            <img src={item.url} alt={item.name} />
                          </button>
                          <div>
                            <span>
                              {item.width} × {item.height}
                            </span>
                            <button
                              type="button"
                              className="showcase-icon-button"
                              aria-label={`Edit ${item.name}`}
                              title="Edit image"
                              disabled={busy}
                              onClick={() =>
                                setEditing({
                                  blob: item.blob,
                                  name: item.name,
                                  replace: item.id,
                                  captureVersion: item.capture?.version,
                                  previousCrop: item.capture?.crop,
                                })
                              }
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              className="showcase-icon-button"
                              title="Remove image"
                              disabled={busy}
                              aria-label={`Remove ${item.name}`}
                              onClick={() => {
                                setDraft((value) => {
                                  const images = value.images.filter(
                                    (image) => image.id !== item.id,
                                  );
                                  return {
                                    ...value,
                                    images,
                                    text: imageMessageBody(value.text, value.images, images),
                                  };
                                });
                                setError("");
                              }}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                          {item.capture && (
                            <small>Capture · v{item.capture.version} · /overview</small>
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="showcase-compose-actions">
                      <button
                        type="button"
                        id="attach-file"
                        className="showcase-icon-button"
                        aria-label="Attach image"
                        title="Attach an image, or paste an image directly into the text input"
                        disabled={full || busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        <PaperclipIcon />
                      </button>
                      <span className="showcase-muted">{draft.images.length}/4</span>
                      <button
                        type="button"
                        id="post-demo-note"
                        className="showcase-primary"
                        disabled={!hasDraft || busy}
                        onClick={post}
                      >
                        {replyTo ? "Post demo reply" : "Post demo note"}
                      </button>
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      aria-label="Choose feedback images"
                      onChange={(event) => {
                        void attach([...(event.target.files ?? [])]);
                        event.target.value = "";
                      }}
                    />
                    <p className="showcase-footnote">
                      Paste into the note, or attach PNG, JPEG, WebP.
                      <br />
                      Up to 4 images · 5 MiB each · 20 megapixels.
                    </p>
                    {replyTo && (
                      <button
                        type="button"
                        className="showcase-text-button"
                        onClick={() => {
                          setReplyTo(undefined);
                          setNotice("Draft kept. It will be posted as a new note.");
                        }}
                      >
                        Switch to a new note
                      </button>
                    )}
                  </>
                )}
                {error && (
                  <p className="showcase-alert" role="alert">
                    {error}
                  </p>
                )}
                {failNext && (
                  <p className="showcase-warning">
                    Next post will fail once, for the retry walkthrough.
                  </p>
                )}
                <p className="showcase-status" role="status">
                  {busy ? "Preparing image…" : notice}
                </p>
              </div>
            </section>
          </div>
          <footer className="showcase-workspace-footer">
            <strong>Real editor. Local conversation.</strong>
            <span>Images stay in this page. Use the outer r3 panel to send actual feedback.</span>
          </footer>
        </section>

        <section
          className="showcase-tool-notes"
          id="drawing-details"
          aria-label="Image editor features"
        >
          <div>
            <span className="showcase-index">01 / FRAME</span>
            <h3>Keep only what matters.</h3>
            <p>Drag a crop or enter exact coordinates. Use whole image to start over.</p>
          </div>
          <div>
            <span className="showcase-index">02 / MARK</span>
            <h3>Make the detail obvious.</h3>
            <p>Pen, arrow, rectangle. Choose a color and stroke width. Undo, redo, or clear.</p>
          </div>
          <div>
            <span className="showcase-index">03 / ATTACH</span>
            <h3>One image, all the context.</h3>
            <p>
              Use image flattens your edits into a PNG. Cancel leaves the previous image intact.
            </p>
          </div>
        </section>

        <div className="showcase-bottom-grid">
          <section id="recovery-scenarios" className="showcase-detail-panel">
            <p className="showcase-eyebrow">02 / RECOVER & RETRY</p>
            <h2>A draft worth keeping.</h2>
            <p className="showcase-muted">
              Try the moments around the happy path. Each scenario acts on the playground above.
            </p>
            <div className="showcase-scenario">
              <div>
                <h3>Navigate away. Come back.</h3>
                <p>Text, images, and their original context return together.</p>
              </div>
              <button
                type="button"
                id="simulate-recovery"
                disabled={!!recovery || !sample || busy}
                onClick={recoverDemo}
              >
                Try recovery
              </button>
            </div>
            <div className="showcase-scenario">
              <div>
                <h3>A save fails.</h3>
                <p>The draft stays put. A retry posts the message once.</p>
              </div>
              <button
                type="button"
                id="simulate-save-failure"
                disabled={failNext || !!recovery || busy}
                onClick={() => {
                  if (!hasDraft) addSample();
                  setFailNext(true);
                  setError("");
                  setNotice("Post the note to see a recoverable save failure.");
                  focusComposer();
                }}
              >
                Fail next save
              </button>
            </div>
            <div className="showcase-scenario">
              <div>
                <h3>A new version arrives.</h3>
                <p>
                  Existing drafts keep their version. Switching the view never moves the original
                  target.
                </p>
              </div>
              <button
                type="button"
                id="switch-demo-version"
                disabled={version === 4 || !!recovery || busy}
                onClick={() => {
                  if (!hasDraft) addSample();
                  setVersion(4);
                  setNotice("Viewing simulated v4. Your existing draft is still tied to v3.");
                  focusComposer();
                }}
              >
                View demo v4
              </button>
            </div>
            <p className="showcase-footnote">
              In r3, images are saved with browser drafts. If browser storage is unavailable, the
              workspace warns that recovery after reload is unavailable. Unposted drafts block
              handoff until posted or discarded.
            </p>
          </section>

          <section id="agent-handoff" className="showcase-detail-panel">
            <p className="showcase-eyebrow">03 / DELIVER TO AN AGENT</p>
            <h2>Pixels travel with the note.</h2>
            <p className="showcase-muted">
              Image references appear in agent feedback. Fetch into a directory to download and
              check the actual files before acknowledging the feedback.
            </p>
            <div className="showcase-terminal">
              <div>
                <span className="showcase-live-dot" />
                CLI / example command
              </div>
              <code>{command}</code>
            </div>
            <ol className="showcase-delivery">
              {[
                "Feedback pending",
                "Images downloaded & verified",
                "Feedback written to stdout",
                "Snapshot acknowledged",
              ].map((label, index) => (
                <li key={label} className={index <= handoff ? "is-done" : ""}>
                  <span>{index < handoff ? "✓" : index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <p id="image-verification" className="showcase-footnote mb-4">
              <strong>What does verified mean?</strong> Each downloaded image must match the byte
              count and SHA-256 hash recorded with the feedback. This confirms file integrity; the
              agent still needs to open the image to understand it. A mismatch leaves feedback
              pending.
            </p>
            <div className="showcase-actions">
              <button
                type="button"
                id="advance-handoff"
                disabled={hasDraft || !!recovery || busy}
                onClick={() => setHandoff((step) => (step + 1) % 4)}
              >
                {handoff === 3 ? "Restart walkthrough" : "Next delivery step"}
              </button>
              <span className="showcase-muted">Simulation</span>
            </div>
            <p className="showcase-footnote" role="status">
              {hasDraft || recovery
                ? "Post or discard the playground draft to continue handoff."
                : handoff === 3
                  ? "Acknowledged means handed off successfully. It is not proof that a model viewed the pixels."
                  : "If downloading, saving, or output fails, feedback stays pending."}
            </p>
            <details>
              <summary>More image commands</summary>
              <p className="showcase-muted">
                Agents should open relevant images before replying. CLI attachments accept PNG and
                JPEG.
              </p>
              <pre>
                <code>
                  {
                    "r3 feedback add artifact_example --attach screenshot.png\nr3 reply feedback_example --attach annotated.png\nr3 feedback edit feedback_example --clear-attachments"
                  }
                </code>
              </pre>
            </details>
          </section>
        </div>
        <footer className="showcase-page-footer">
          <span>
            <strong>r3</strong> Render. Review. Refine.
          </span>
          <span>Capture · Paste · Crop · Draw · Reply · Recover · Deliver</span>
          <a href="#showcase-top">Back to top ↑</a>
        </footer>
      </div>

      {editing && (
        <ImageEditor blob={editing.blob} onCancel={() => setEditing(null)} onSave={saveEdit} />
      )}
      {viewer && (
        <Overlay title={viewer.name} close={() => setViewer(null)}>
          <img className="showcase-full-image" src={viewer.url} alt={viewer.name} />
          <p>
            {viewer.width} × {viewer.height} · PNG ·{" "}
            {Math.max(1, Math.round(viewer.blob.size / 1024))} KiB
          </p>
          {viewer.capture && (
            <p>
              Captured context: v{viewer.capture.version}, index.html, /overview · viewport 1200 ×
              760 · crop {viewer.capture.crop.x}, {viewer.capture.crop.y},{" "}
              {viewer.capture.crop.width} × {viewer.capture.crop.height}
            </p>
          )}
          <p className="showcase-muted">
            The image accompanies the message. It does not change the original feedback target.
          </p>
        </Overlay>
      )}
      {capture && (
        <Overlay title="Capture area · walkthrough" close={() => setCapture(false)}>
          <p className="showcase-eyebrow">SIMULATED BROWSER CHOOSER</p>
          <h3>Choose the current r3 tab.</h3>
          <p>
            The real workspace asks your browser for permission each time, isolates the preview
            area, freezes one frame, then stops sharing before the editor opens.
          </p>
          <div className="showcase-capture-choice">
            <span>▣</span>
            <div>
              <strong>Current r3 tab</strong>
              <p>Studio / overview · v{version}</p>
            </div>
            <span className="showcase-chip">Required</span>
          </div>
          <p className="showcase-muted">
            This walkthrough uses the sample image. It does not request screen access. If capture is
            unavailable or denied, paste or attach a file instead.
          </p>
          <div className="showcase-actions">
            <button
              type="button"
              onClick={() => {
                setCapture(false);
                setNotice("Capture canceled. Your existing draft is unchanged.");
              }}
            >
              Cancel capture
            </button>
            <button
              type="button"
              onClick={() => {
                setCapture(false);
                setError(
                  "Simulated capture unavailable. Paste an image into the note, or use Attach image.",
                );
              }}
            >
              Try denied permission
            </button>
            <button
              type="button"
              className="showcase-primary"
              id="simulate-capture"
              onClick={() => {
                setCapture(false);
                if (sample)
                  setEditing({
                    blob: sample.blob,
                    name: "captured-overview.png",
                    captureVersion: version,
                  });
              }}
            >
              Use sample frame →
            </button>
          </div>
        </Overlay>
      )}
    </main>
  );
}
