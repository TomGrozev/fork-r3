import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { suspendKeys } from "../keys.ts";
import { Button } from "../ui.tsx";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ImageEditor({
  blob,
  onCancel,
  onSave,
}: {
  blob: Blob;
  onCancel: () => void;
  onSave: (blob: Blob, crop: ImageCrop) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<ImageCrop | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    const resume = suspendKeys();
    node?.showModal();
    return () => {
      node?.close();
      resume();
    };
  }, []);
  useEffect(() => {
    let current = true;
    void createImageBitmap(blob)
      .then((image) => {
        if (!current) {
          image.close();
          return;
        }
        bitmap.current = image;
        setSize({ width: image.width, height: image.height });
      })
      .catch(() => {
        if (current) setError("Unable to open this image");
      });
    return () => {
      current = false;
      bitmap.current?.close();
      bitmap.current = null;
    };
  }, [blob]);
  useLayoutEffect(() => {
    if (!canvas.current || !bitmap.current) return;
    const ctx = canvas.current.getContext("2d")!;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap.current, 0, 0);
    if (crop) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, size.width, crop.y);
      ctx.fillRect(0, crop.y + crop.height, size.width, size.height - crop.y - crop.height);
      ctx.fillRect(0, crop.y, crop.x, crop.height);
      ctx.fillRect(crop.x + crop.width, crop.y, size.width - crop.x - crop.width, crop.height);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    }
  }, [size, crop]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(
        Math.max(0, Math.min(size.width, ((event.clientX - rect.left) * size.width) / rect.width)),
      ),
      y: Math.round(
        Math.max(
          0,
          Math.min(size.height, ((event.clientY - rect.top) * size.height) / rect.height),
        ),
      ),
    };
  };
  const save = async () => {
    if (!bitmap.current || saving) return;
    setSaving(true);
    setError("");
    try {
      const area = crop ?? { x: 0, y: 0, ...size };
      const output = document.createElement("canvas");
      output.width = area.width;
      output.height = area.height;
      output
        .getContext("2d")!
        .drawImage(
          bitmap.current,
          area.x,
          area.y,
          area.width,
          area.height,
          0,
          0,
          area.width,
          area.height,
        );
      const result = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (image) => (image ? resolve(image) : reject(new Error("Unable to crop image"))),
          "image/png",
        ),
      );
      await onSave(result, area);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save image");
      setSaving(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded-xl border border-neutral-300 bg-white p-4 text-neutral-900 r3-modal backdrop:bg-black/50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={title} className="text-sm font-semibold">
          Crop image
        </h2>
        <Button disabled={saving} onClick={() => setCrop(null)}>
          Use whole image
        </Button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Drag to select an area, or enter its position and size below.
      </p>
      <canvas
        ref={canvas}
        width={size.width}
        height={size.height}
        aria-label="Image crop area"
        className="mx-auto block max-h-[60dvh] max-w-full touch-none cursor-crosshair border border-neutral-300 object-contain dark:border-neutral-700"
        onPointerDown={(event) => {
          if (saving) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point(event);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const end = point(event);
          const begin = start.current;
          setCrop({
            x: Math.min(size.width - 1, begin.x, end.x),
            y: Math.min(size.height - 1, begin.y, end.y),
            width: Math.max(1, Math.abs(end.x - begin.x)),
            height: Math.max(1, Math.abs(end.y - begin.y)),
          });
        }}
        onPointerUp={() => {
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      />
      {size.width > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key} className="text-xs text-neutral-500">
              {key}
              <input
                aria-label={`Crop ${key}`}
                type="number"
                min={key === "x" || key === "y" ? 0 : 1}
                max={key === "x" || key === "width" ? size.width : size.height}
                className="ml-2 w-20 border border-neutral-300 bg-transparent px-2 py-1 text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
                disabled={saving}
                value={(crop ?? { x: 0, y: 0, ...size })[key]}
                onChange={(event) => {
                  const next = {
                    ...(crop ?? { x: 0, y: 0, ...size }),
                    [key]: Math.round(Number(event.target.value)),
                  };
                  next.x = Math.max(0, Math.min(size.width - 1, next.x));
                  next.y = Math.max(0, Math.min(size.height - 1, next.y));
                  next.width = Math.max(1, Math.min(size.width - next.x, next.width));
                  next.height = Math.max(1, Math.min(size.height - next.y, next.height));
                  setCrop(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!size.width || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Use image"}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
