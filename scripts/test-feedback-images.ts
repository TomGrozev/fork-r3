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
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${css ? `<link rel="stylesheet" href="/${css}">` : ""}<style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script type="module" src="/${js}"></script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined;
try {
  browser = await openTestBrowser([
    "--window-size=1400,1100",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--auto-accept-this-tab-capture",
    "--enable-usermedia-screen-capturing",
  ]);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = await browser.attach(targetId);
  await page.command("Emulation.clearDeviceMetricsOverride");
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
  const editorCanvas = "document.querySelector('dialog[open] canvas')";
  const openEditor = async () => {
    await page.evaluate(`${button("Edit image")}.click()`);
    await eventually(
      () => page.evaluate(`${editorCanvas}?.width === 160`),
      "editable image bitmap",
    );
  };
  const draw = async (tool: string, color: string, points: [number, number][]) => {
    await page.evaluate(
      `(()=>{${button(tool)}.click();const color=document.querySelector('[aria-label="Drawing color"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(color,${JSON.stringify(color)});color.dispatchEvent(new Event('input',{bubbles:true}));color.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    const rect = await page.evaluate(
      `(()=>{const c=${editorCanvas};const r=c.getBoundingClientRect();return {x:r.x+c.clientLeft,y:r.y+c.clientTop,sx:c.clientWidth/c.width,sy:c.clientHeight/c.height}})()`,
    );
    const screen = ([x, y]: [number, number]) => ({
      x: rect.x + x * rect.sx,
      y: rect.y + y * rect.sy,
    });
    await page.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...screen(points[0]!),
    });
    for (const point of points.slice(1))
      await page.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        ...screen(point),
      });
    await page.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...screen(points.at(-1)!),
    });
  };
  const previewPixels = () => page.evaluate(`${editorCanvas}.toDataURL()`);
  const sample = (x: number, y: number) =>
    page.evaluate(`Array.from(${editorCanvas}.getContext('2d').getImageData(${x},${y},1,1).data)`);
  await openEditor();
  const originalPixels = await previewPixels();
  await draw("Pen", "#0000ff", [
    [10, 75],
    [70, 75],
  ]);
  assert.notEqual(await previewPixels(), originalPixels);
  await page.evaluate(`${button("Cancel")}.click()`);
  await openEditor();
  assert.equal(await previewPixels(), originalPixels, "cancel preserves the original draft image");
  await draw("Arrow", "#0000ff", [
    [10, 50],
    [80, 50],
  ]);
  assert.deepEqual(await sample(40, 50), [0, 0, 255, 255]);
  await draw("Rectangle", "#00ff00", [
    [100, 15],
    [145, 65],
  ]);
  assert.deepEqual(await sample(100, 40), [0, 255, 0, 255]);
  await page.evaluate(
    `(()=>{const select=document.querySelector('[aria-label="Stroke width"]');select.value='8';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await draw("Pen", "#8000ff", [
    [10, 75],
    [40, 65],
    [70, 75],
  ]);
  const annotatedPixels = await previewPixels();
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "z",
    code: "KeyZ",
    modifiers: 2,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "z",
    code: "KeyZ",
    modifiers: 2,
  });
  assert.notEqual(await previewPixels(), annotatedPixels);
  await page.evaluate(`${button("Redo")}.click()`);
  assert.equal(await previewPixels(), annotatedPixels);
  await page.evaluate(`${button("Clear drawings")}.click()`);
  assert.equal(await previewPixels(), originalPixels);
  await page.evaluate(`${button("Undo")}.click()`);
  assert.equal(await previewPixels(), annotatedPixels, "clearing drawings is undoable");
  await page.evaluate(`${button("Undo")}.click()`);
  await draw("Pen", "#8000ff", [
    [10, 75],
    [40, 65],
    [70, 75],
  ]);
  assert.equal(
    await page.evaluate(`${button("Redo")}.disabled`),
    true,
    "new drawing discards undone branch",
  );
  await page.evaluate(`${button("Use image")}.click()`);
  await eventually(
    () => page.evaluate("!document.querySelector('dialog[open]')"),
    "flattened drawings in draft",
  );
  // Reopen the saved draft in the actual phone layout and exercise touch input.
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await eventually(
    () =>
      page.evaluate(
        "innerWidth === 390 && !!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('· 0 open'))",
      ),
    "phone feedback sheet",
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('· 0 open')).click();document.documentElement.classList.add('dark')",
  );
  await openEditor();
  assert.equal(await previewPixels(), annotatedPixels);
  await page.evaluate(`${button("Pen")}.click()`);
  const touch = await page.evaluate(
    `(()=>{const c=${editorCanvas};const r=c.getBoundingClientRect();return {x:r.x+c.clientLeft+120*c.clientWidth/c.width,y:r.y+c.clientTop+75*c.clientHeight/c.height}})()`,
  );
  await page.command("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...touch, id: 1 }],
  });
  await page.command("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touch, x: touch.x + 10, id: 1 }],
  });
  await page.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.notEqual(await previewPixels(), annotatedPixels, "touch draws in the phone editor");
  assert.equal(
    await page.evaluate(
      "document.querySelector('dialog[open]').scrollWidth <= document.querySelector('dialog[open]').clientWidth",
    ),
    true,
  );
  if (process.env.R3_TEST_IMAGE_OUTPUT) {
    const screenshot = await page.command("Page.captureScreenshot", { format: "png" });
    await Bun.write(
      join(process.env.R3_TEST_IMAGE_OUTPUT, "image-editor-mobile.png"),
      Buffer.from(screenshot.data, "base64"),
    );
  }
  await page.evaluate(`${button("Cancel")}.click()`);
  await page.command("Emulation.clearDeviceMetricsOverride");
  await page.evaluate("document.documentElement.classList.remove('dark')");
  await eventually(
    () =>
      page.evaluate(
        "innerWidth === 1400 && !!document.querySelector('[data-artifact-composer] img')",
      ),
    "desktop draft after phone editing",
  );
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
  const drawnImage = await storage.artifacts.attachments.read(
    artifact.id,
    note.attachments![0]!.id,
  );
  const savedPixels = await page.evaluate(
    `(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(drawnImage.bytes.toString("base64"))}),x=>x.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return [[40,50],[100,40],[40,65]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));})()`,
  );
  assert.deepEqual(
    savedPixels,
    [
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [128, 0, 255, 255],
    ],
    "posted PNG contains flattened arrow, rectangle and pen",
  );
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
    `window.captureTracks=[];const native=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async options=>{const stream=await native(options);window.captureTracks.push(...stream.getTracks());return stream;}`,
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
  // Ensure a real compositor paint before the headless chooser auto-accepts.
  await page.command("Page.captureScreenshot", { format: "png" });
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
  const capturedSize = await page.evaluate(
    "(()=>{const canvas=document.querySelector('dialog[open] canvas');const frame=document.querySelector('iframe');return {width:canvas.width,height:canvas.height,previewWidth:frame.clientWidth,previewHeight:frame.clientHeight}})()",
  );
  assert(
    capturedSize.width <= capturedSize.previewWidth + 2 &&
      capturedSize.height <= capturedSize.previewHeight + 2,
    "capture excludes workspace pixels outside the preview",
  );
  const setNumber = async (label: string, value: string) => {
    await page.evaluate(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').focus();document.querySelector('[aria-label=${JSON.stringify(label)}]').select()`,
    );
    await page.command("Input.insertText", { text: value });
  };
  await draw("Rectangle", "#ef4444", [
    [20, 20],
    [80, 60],
  ]);
  await setNumber("Crop x", "10");
  await setNumber("Crop y", "10");
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
  assert.equal(screenshot.attachments![0]!.capture?.crop.x, 10);
  assert.equal(screenshot.attachments![0]!.capture?.crop.y, 10);
  const cropped = await storage.artifacts.attachments.read(
    artifact.id,
    screenshot.attachments![0]!.id,
  );
  const croppedPixel = await page.evaluate(
    `(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(cropped.bytes.toString("base64"))}),x=>x.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return Array.from(ctx.getImageData(10,30,1,1).data);})()`,
  );
  assert.deepEqual(
    croppedPixel,
    [239, 68, 68, 255],
    "crop translates drawings into exported pixel coordinates",
  );
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
    const originalImageCapture = window.ImageCapture;
    const element = document.querySelector('iframe');
    const source = document.createElement('canvas');source.width=32;source.height=32;
    let stream=source.captureStream(0);let track=stream.getVideoTracks()[0];
    const prepareTrack=()=>{track.getSettings=()=>({displaySurface:'browser'});track.cropTo=()=>new Promise(()=>{});};prepareTrack();
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
      stream=source.captureStream(0);track=stream.getVideoTracks()[0];prepareTrack();
      navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(stream);
      const cropping = new AbortController();
      const stalled = reason(capturePreview(element, cropping.signal));
      await new Promise(resolve=>setTimeout(resolve,50));
      cropping.abort();
      const cropAborted = await stalled;
      const cropStopped=track.readyState === 'ended';
      stream=source.captureStream(0);track=stream.getVideoTracks()[0];prepareTrack();track.cropTo=()=>Promise.resolve();
      let attempts=0, prompts=0;
      window.ImageCapture=class {grabFrame(){attempts++;return attempts===1 ? Promise.reject(undefined) : createImageBitmap(source)}};
      navigator.mediaDevices.getDisplayMedia=()=>{prompts++;return Promise.resolve(stream)};
      const retried=await capturePreview(element,new AbortController().signal);
      return {denied, aborted, locked, lateStopped, cropAborted, cropStopped, attempts, prompts, retryType:retried.type, retryStopped:track.readyState==='ended'};
    } finally { navigator.mediaDevices.getDisplayMedia = original; window.ImageCapture=originalImageCapture; }
  })()`);
  assert.equal(cancelled.denied, "NotAllowedError");
  assert.equal(cancelled.aborted, "AbortError");
  assert.equal(cancelled.locked, "Error");
  assert.equal(cancelled.lateStopped, true);
  assert.equal(cancelled.cropAborted, "AbortError");
  assert.equal(cancelled.cropStopped, true);
  assert.equal(cancelled.attempts, 2);
  assert.equal(cancelled.prompts, 1);
  assert.equal(cancelled.retryType, "image/png");
  assert.equal(cancelled.retryStopped, true);
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  console.log(
    "Feedback images: paste, reload, retry, reply, real tab capture, crop, drawing, undo/redo, cancellation, flattened pixels, scoped bridge, and narrow layout passed",
  );
} finally {
  await browser?.close();
  app.stop(true);
  api.close();
  storage.close();
  await rm(root, { recursive: true, force: true });
}
