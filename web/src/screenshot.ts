import { ATTACHMENT_LIMITS } from "../../shared/attachments.ts";

type CroppableTrack = MediaStreamTrack & { cropTo(target: unknown): Promise<void> };
type CropWindow = Window & { CropTarget?: { fromElement(element: Element): Promise<unknown> } };
let requesting = false;

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export function canCapturePreview(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !!(window as CropWindow).CropTarget
  );
}

// The trusted workspace owns every track. No frame, port, or publisher utility
// ever receives the stream or its uncropped pixels.
export async function capturePreview(element: HTMLElement, signal: AbortSignal): Promise<Blob> {
  if (!canCapturePreview())
    throw new Error("Area capture is unavailable here. Paste or attach a screenshot instead.");
  if (requesting) throw new Error("Finish the existing browser sharing prompt first");
  requesting = true;
  let stream: MediaStream | undefined;
  let video: HTMLVideoElement | undefined;
  let chooserPending = false;
  const stop = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
  };
  signal.addEventListener("abort", stop);
  const check = () => {
    signal.throwIfAborted();
    if (!element.isConnected) throw new Error("The preview changed. Capture it again.");
  };
  try {
    check();
    // Invoke synchronously from the button's gesture, before deriving a target.
    const request = navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      preferCurrentTab: true,
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
    chooserPending = true;
    const chosen = request.then(
      (result) => {
        chooserPending = false;
        // Native prompts cannot be dismissed programmatically. A late grant must
        // be stopped even after the cancelled caller has already returned.
        if (signal.aborted) {
          for (const track of result.getTracks()) track.stop();
          requesting = false;
        }
        return result;
      },
      (error) => {
        chooserPending = false;
        requesting = false;
        throw error;
      },
    );
    stream = await untilAborted(chosen, signal);
    check();
    const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
    if (track?.getSettings().displaySurface !== "browser" || typeof track.cropTo !== "function")
      throw new Error("Select this r3 browser tab to capture the preview");
    const target = await untilAborted(
      (window as CropWindow).CropTarget!.fromElement(element),
      signal,
    );
    check();
    await untilAborted(track.cropTo(target), signal);
    check();
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await untilAborted(video.play(), signal);
    check();
    if (!video.videoWidth || !video.videoHeight || track.readyState !== "live")
      throw new Error("The browser did not provide a screenshot frame");
    if (video.videoWidth * video.videoHeight > ATTACHMENT_LIMITS.pixels)
      throw new Error("Preview exceeds 20 megapixels. Reduce the window size and try again.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await untilAborted(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("Unable to capture this preview"))),
          "image/png",
        ),
      ),
      signal,
    );
    check();
    return blob;
  } finally {
    stop();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    signal.removeEventListener("abort", stop);
    if (!chooserPending) requesting = false;
  }
}
