import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactApi } from "../server/artifact-api.ts";
import { openArtifactStorage } from "../server/artifact-storage.ts";
import { PREVIEW_PREFIX } from "../server/preview-contexts.ts";
import { PreviewHost } from "../server/preview-host.ts";
import { previewSupport } from "../server/preview-support.ts";
import { eventually, openTestBrowser } from "./browser.ts";
import { browserLoweredCssPlugin } from "./spa-css.ts";

const build = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "preview-workspace-fixture.tsx"),
    join(import.meta.dir, "../web/src/screenshot.ts"),
  ],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [await browserLoweredCssPlugin()],
});
if (!build.success) throw new Error("Browser acceptance workspace failed to build");
const assets = new Map(build.outputs.map((output) => [output.path.split("/").at(-1)!, output]));
const js = build.outputs
  .find((output) => output.path.endsWith("preview-workspace-fixture.js"))!
  .path.split("/")
  .at(-1)!;
const css = build.outputs
  .find((output) => output.path.endsWith(".css"))
  ?.path.split("/")
  .at(-1);
const root = await mkdtemp(join(tmpdir(), "r3-workspace-acceptance-"));
const storage = await openArtifactStorage({ databasePath: join(root, "store.sqlite") });
const actor = { role: "human" as const, sessionId: null };
const artifact = storage.artifacts.create({
  kind: "html",
  actor,
  title: "Image feedback acceptance",
});
const source =
  '<!doctype html><html><head><title>Published fixture</title></head><body><h1 id="heading">Published first version</h1><p id="output">Ready</p><button id="send">Request revision</button><a href="other.html">Other document</a><script type="module">import r3 from "/r3/utility.js";send.onclick=async()=>{try{await r3.setTheme("dark");const note=await r3.createFeedback({body:"Please revise this chart",locator:{selector:"#heading",quote:document.querySelector("h1").textContent}});window.lastFeedback=note.id;output.textContent="Sent: "+note.id;}catch(error){output.textContent=error.message}};window.r3=r3;</script></body></html>';
for (const seq of [1, 2])
  await storage.artifacts.publish(artifact.id, {
    actor,
    expectedSeq: seq - 1,
    publicationKey: `publication-${seq}`,
    content: {
      kind: "html",
      files: [
        {
          path: "index.html",
          mediaType: "text/html",
          base64: Buffer.from(
            seq === 1 ? source : source.replace("first version", "second version"),
          ).toString("base64"),
        },
        {
          path: "other.html",
          mediaType: "text/html",
          base64: Buffer.from(
            '<!doctype html><h1>Other published document</h1><a href="index.html">Back</a>',
          ).toString("base64"),
        },
      ],
    },
  });
const preview = new PreviewHost(storage.artifacts, undefined, previewSupport);
let failNextPost = false;
const api = createArtifactApi(
  storage,
  {
    token: randomBytes(32).toString("base64url"),
    requireLogin: false,
    version: "acceptance",
    allowedHost: (host) => host === "localhost",
  },
  { previews: preview },
);
const app = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 60,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(PREVIEW_PREFIX)) return preview.fetch(request);
    if (failNextPost && request.method === "POST" && path.endsWith("/feedback")) {
      failNextPost = false;
      return Response.json({ error: "Image save failed; retry" }, { status: 503 });
    }
    if (path.startsWith("/api/")) return api.app.fetch(request);
    const asset = assets.get(path.slice(1));
    if (asset) return new Response(asset);
    return new Response(
      `<!doctype html><html><head>${css ? `<link rel="stylesheet" href="/${css}">` : ""}<style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script type="module" src="/${js}"></script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined;
try {
  browser = await openTestBrowser([
    "--auto-accept-this-tab-capture",
    "--enable-usermedia-screen-capturing",
  ]);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = await browser.attach(targetId);
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.command("Page.navigate", { url: `http://localhost:${app.port}/?version=1` });
  const button = (label: string) =>
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const input = "document.querySelector('[data-artifact-composer]:not([data-reply-to]) textarea')";
  await eventually(async () => {
    await page.evaluate(`${button("Accept risk and continue")}?.click()`);
    return page.evaluate(`!!${button("Capture area")}`);
  }, "HTML capture control");
  await page.evaluate("document.querySelector('[aria-label=\"Add general feedback\"]').click()");
  await eventually(() => page.evaluate(`!!(${input})`), "composer");
  const paste = async (selector: string) =>
    page.evaluate(`(() => {
    const canvas=document.createElement('canvas'); canvas.width=160;canvas.height=90;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f05020';ctx.fillRect(0,0,160,90);ctx.fillStyle='#ffffff';ctx.fillText('Image feedback',10,30);
    return new Promise(resolve=>canvas.toBlob(blob=>{
      const data=new DataTransfer();data.items.add(new File([blob],'image.png',{type:'image/png'}));
      (${selector}).dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));resolve(true);
    },'image/png'));
  })()`);
  await paste(input);
  await eventually(
    () => page.evaluate("!!document.querySelector('[data-artifact-composer] img')"),
    "pasted image preview",
  );
  await page.command("Page.reload");
  await eventually(
    () => page.evaluate("!!document.querySelector('[data-artifact-composer] img')"),
    "image draft restored from IndexedDB",
  );
  assert.equal(await page.evaluate(`${input}.value`), "");
  failNextPost = true;
  await page.evaluate(`${input}.form.requestSubmit()`);
  await eventually(
    () =>
      page.evaluate(
        "document.querySelector('[data-artifact-composer] [role=alert]')?.textContent.includes('retry')",
      ),
    "failed image save",
  );
  assert.equal(storage.conversations.list(artifact.id).length, 0);
  await page.evaluate(`${input}.form.requestSubmit()`);
  await eventually(
    () =>
      page.evaluate(
        "!!document.querySelector('[data-artifact-feedback] img') && !document.querySelector('[data-artifact-composer]')",
      ),
    "image-only note saved",
  );
  const note = storage.conversations.list(artifact.id)[0]!;
  assert.equal(note.body, "");
  assert.equal(note.attachments?.length, 1);
  assert.equal(note.attachments![0]!.width, 160);
  await page.evaluate(
    "document.querySelector('[data-artifact-feedback] [data-feedback-action=reply]').click()",
  );
  const replyInput = "document.querySelector('[data-reply-to] textarea')";
  await eventually(() => page.evaluate(`!!(${replyInput})`), "reply composer");
  await paste(replyInput);
  await eventually(
    () => page.evaluate("!!document.querySelector('[data-reply-to] img')"),
    "reply image preview",
  );
  await page.evaluate(`${replyInput}.form.requestSubmit()`);
  await eventually(
    () => Promise.resolve(storage.conversations.get(note.id).replies.length === 1),
    "image reply saved",
  );
  assert.equal(storage.conversations.get(note.id).replies[0]!.attachments?.length, 1);
  // The trusted parent's display capture uses a real tab stream, never a fake image.
  await page.evaluate(
    `window.captureTracks=[]; const native=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async options=>{const stream=await native(options);window.captureTracks.push(...stream.getTracks());window.captureStage='granted';const track=stream.getVideoTracks()[0];const crop=track.cropTo.bind(track);track.cropTo=async target=>{window.captureStage='cropping';await crop(target);window.captureStage='cropped'};return stream;}`,
  );
  await eventually(
    () => page.evaluate("!document.querySelector('[data-reply-to]')"),
    "reply save completes",
  );
  await eventually(
    () => page.evaluate(`!!${button("Capture area")} && !${button("Capture area")}.disabled`),
    "ready capture control after reply",
  );
  await page.command("Page.bringToFront");
  const clicked = await page.command("Runtime.evaluate", {
    expression: `${button("Capture area")}.click()`,
    userGesture: true,
  });
  assert(!clicked.exceptionDetails, JSON.stringify(clicked.exceptionDetails));
  await eventually(
    () => page.evaluate("!!document.querySelector('dialog[open] [aria-label=\"Crop width\"]')"),
    "captured preview crop editor",
  );
  assert(
    await page.evaluate(
      "window.captureTracks.length > 0 && window.captureTracks.every(track=>track.readyState==='ended')",
    ),
  );
  const setNumber = async (label: string, value: string) => {
    await page.evaluate(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').focus();document.querySelector('[aria-label=${JSON.stringify(label)}]').select()`,
    );
    await page.command("Input.insertText", { text: value });
  };
  await setNumber("Crop width", "100");
  await setNumber("Crop height", "80");
  await page.evaluate(`${button("Use image")}.click()`);
  await eventually(
    () => page.evaluate("!!document.querySelector('[data-artifact-composer] img')"),
    "captured image in native draft",
  );
  await page.evaluate(`${input}.form.requestSubmit()`);
  await eventually(
    () => Promise.resolve(storage.conversations.list(artifact.id).length === 2),
    "screenshot saved",
  );
  const screenshot = storage.conversations.list(artifact.id)[1]!;
  assert.equal(screenshot.target.kind, "rendered");
  assert.equal(screenshot.attachments![0]!.width, 100);
  assert.equal(screenshot.attachments![0]!.height, 80);
  assert.equal(screenshot.attachments![0]!.capture?.versionSeq, 1);
  const previewPage = await eventually(async () => {
    const targets = await browser!.send("Target.getTargets");
    const target = targets.targetInfos.find(
      (item: { type: string; url: string }) =>
        item.type === "iframe" && item.url.includes(PREVIEW_PREFIX),
    );
    return target ? browser!.attach(target.targetId) : null;
  }, "isolated preview target");
  const threads = await previewPage.evaluate("window.r3.getThreads()");
  assert(
    threads.every(
      (thread: { attachments?: unknown; replies: { attachments?: unknown }[] }) =>
        !thread.attachments && thread.replies.every((reply) => !reply.attachments),
    ),
  );
  const cancelled = await page.evaluate(`(async () => {
    const { capturePreview } = await import('/screenshot.js');
    const original = navigator.mediaDevices.getDisplayMedia;
    const element = document.querySelector('iframe');
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, getSettings() { return {displaySurface:'browser'}; }, cropTo() { return new Promise(() => {}); } };
    const stream = {getTracks:()=>[track], getVideoTracks:()=>[track]};
    const reason = async promise => { try { await promise; return 'unexpected success'; } catch (error) { return error.name || error.message; } };
    try {
      navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      const denied = await reason(capturePreview(element, new AbortController().signal));
      let grant;
      navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => {grant=resolve});
      const controller = new AbortController();
      const pending = reason(capturePreview(element, controller.signal));
      controller.abort();
      const aborted = await pending;
      const locked = await reason(capturePreview(element, new AbortController().signal));
      grant(stream);
      await Promise.resolve(); await Promise.resolve();
      const lateStopped = track.readyState === 'ended';
      track.readyState = 'live';
      navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(stream);
      const cropping = new AbortController();
      const stalled = reason(capturePreview(element, cropping.signal));
      await new Promise(resolve=>setTimeout(resolve,50));
      cropping.abort();
      const cropAborted = await stalled;
      return {denied, aborted, locked, lateStopped, cropAborted, cropStopped:track.readyState === 'ended'};
    } finally { navigator.mediaDevices.getDisplayMedia = original; }
  })()`);
  assert.equal(cancelled.denied, "NotAllowedError");
  assert.equal(cancelled.aborted, "AbortError");
  assert.equal(cancelled.locked, "Error");
  assert.equal(cancelled.lateStopped, true);
  assert.equal(cancelled.cropAborted, "AbortError");
  assert.equal(cancelled.cropStopped, true);
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  console.log(
    "Feedback images: paste, reload, retry, reply, real tab capture, crop, stopped tracks, scoped bridge, and narrow layout passed",
  );
} finally {
  await browser?.close();
  app.stop(true);
  api.close();
  storage.close();
  await rm(root, { recursive: true, force: true });
}
