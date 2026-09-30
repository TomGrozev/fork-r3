import assert from "node:assert/strict";
import { join } from "node:path";
import { eventually, openTestBrowser } from "./browser.ts";
import { browserLoweredCssPlugin } from "./spa-css.ts";

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "screenshot-support-fixture.tsx")],
  target: "browser",
  minify: true,
  plugins: [await browserLoweredCssPlugin()],
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!build.success) throw new Error("Screenshot capability fixture failed to build");
const assets = new Map(build.outputs.map((output) => [output.path.split("/").at(-1)!, output]));
const app = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const asset = assets.get(new URL(request.url).pathname.slice(1));
    if (asset) return new Response(asset);
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/screenshot-support-fixture.css"><div id="root"></div><script type="module" src="/screenshot-support-fixture.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
const browser = await openTestBrowser();
try {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = await browser.attach(targetId);
  const unexplained: string[] = [];
  for (const missing of ["", "region", "frame", "display"]) {
    await page.command("Page.navigate", {
      url: `http://localhost:${app.port}/?missing=${missing}`,
    });
    await eventually(() => page.evaluate("!!document.querySelector('button')"), "capture toolbar");
    const state = await page.evaluate(`({
      disabled: document.querySelector('button').disabled,
      text: document.body.textContent,
      description: document.getElementById(document.querySelector('button').getAttribute('aria-describedby'))?.textContent,
    })`);
    assert.equal(state.disabled, !!missing, "Capture area matches the available browser APIs");
    if (missing) {
      if (!/capture is unavailable/i.test(state.text)) unexplained.push(missing);
      assert.match(state.text, /paste or attach/i, "Unsupported browsers retain image feedback");
      assert.match(
        state.description,
        /capture is unavailable/i,
        "The control describes its disabled state",
      );
    }
  }
  assert.deepEqual(unexplained, [], "Disabled capture explains unavailable browser support");
  console.log("Screenshot capability acceptance passed");
} finally {
  await browser.close();
  app.stop(true);
}
