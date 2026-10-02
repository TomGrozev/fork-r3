import type { ApplicationBootstrap } from "./types.ts";

// Consume only this navigation's server-owned snapshot, before mounting React.
// Later visits, login, and failed/missing snapshots use the ordinary API path.
export function takeApplicationBootstrap(): ApplicationBootstrap | undefined {
  const element = document.getElementById("r3-bootstrap");
  if (!element) return;
  const text = element.textContent;
  element.remove();
  try {
    const data = JSON.parse(text ?? "null") as ApplicationBootstrap | null;
    if (
      data?.path === location.pathname &&
      data.boot?.needsAuth === false &&
      (data.boot.token === null || typeof data.boot.token === "string") &&
      (data.artifact === null || data.path.replace(/\/$/, "") === `/${data.artifact?.id}`)
    )
      return data;
  } catch {
    // A malformed shell snapshot cannot prevent a fresh authenticated bootstrap.
  }
}
