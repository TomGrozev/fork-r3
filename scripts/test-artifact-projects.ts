import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactApi } from "../server/artifact-api.ts";
import { openArtifactStorage } from "../server/artifact-storage.ts";
import { eventually, openTestBrowser } from "./browser.ts";
import { browserLoweredCssPlugin } from "./spa-css.ts";

// Project changes must reach an already-open home without focus or polling.
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "../web/src/main.tsx")],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [await browserLoweredCssPlugin()],
});
if (!build.success) throw new Error("Project acceptance app failed to build");
const assets = new Map(build.outputs.map((output) => [output.path.split("/").at(-1)!, output]));
const assetName = (suffix: string) =>
  build.outputs
    .find((output) => output.path.endsWith(suffix))!
    .path.split("/")
    .at(-1)!;
const root = await mkdtemp(join(tmpdir(), "r3-projects-"));
const storage = await openArtifactStorage({ databasePath: join(root, "store.sqlite") });
const token = randomBytes(32).toString("base64url");
const api = createArtifactApi(storage, {
  token,
  requireLogin: false,
  version: "acceptance",
  allowedHost: (host) => host === "localhost",
});
let eventConnections = 0;
const app = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 60,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/events") eventConnections++;
    if (path.startsWith("/api/")) return api.app.fetch(request);
    const asset = assets.get(path.slice(1));
    if (asset) return new Response(asset);
    return new Response(
      `<!doctype html><html><head><link rel="stylesheet" href="/${assetName(".css")}"></head><body><div id="root"></div><script type="module" src="/${assetName(".js")}"></script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
async function request(path: string, method: string, body?: unknown) {
  const response = await fetch(`http://localhost:${app.port}${path}`, {
    method,
    headers: { "x-r3-token": token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `Project acceptance request failed: ${method} ${path}`);
  return response.json();
}
let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined;
try {
  browser = await openTestBrowser();
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = await browser.attach(targetId);
  await page.command("Page.navigate", { url: `http://localhost:${app.port}/` });
  await eventually(
    () => page.evaluate("document.body.textContent.includes('No artifacts yet')"),
    "empty artifact home",
  );
  await eventually(async () => eventConnections > 0, "home event connection");
  // Let the initial ready reconciliation finish before changing server state.
  await page.evaluate("new Promise(resolve => setTimeout(resolve, 200))");
  const artifact = await request("/api/artifacts", "POST", {
    kind: "files",
    actor: { role: "human", sessionId: null },
    title: "Project event acceptance",
    remoteUrl: "https://code.example/team/project-event.git",
  });
  const original = storage.artifacts
    .projects()
    .find((project) => project.id === artifact.projectId)!;
  assert(original?.name, "remote inference creates a named project");
  const row = `document.querySelector('a[href="/${artifact.id}"]')`;
  const hasName = (name: string) =>
    page.evaluate<boolean>(`${row}?.textContent.includes(${JSON.stringify(name)}) ?? false`);
  await eventually(() => hasName(original.name!), "inferred project name reaches the open home");
  await request(`/api/projects/${original.id}`, "PATCH", { name: "Renamed project" });
  await eventually(() => hasName("Renamed project"), "renamed project reaches the open home");
  await request(`/api/projects/${original.id}`, "DELETE");
  await eventually(
    async () => (await page.evaluate(`!!${row}`)) && !(await hasName("Renamed project")),
    "deleting a project clears the group while preserving its artifact",
  );
  console.log(
    "Project acceptance passed: inferred names, renames, and deletion update the open home.",
  );
} finally {
  await browser?.close();
  app.stop(true);
  api.close();
  await storage.close();
  await rm(root, { recursive: true, force: true });
}
