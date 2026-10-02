import assert from "node:assert/strict";
import { join } from "node:path";
import { eventually, openTestBrowser } from "./browser.ts";
import { browserLoweredCssPlugin } from "./spa-css.ts";

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "notification-fixture.tsx")],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [await browserLoweredCssPlugin()],
});
if (!build.success) throw new Error("Notification fixture failed to build");
const assets = new Map(build.outputs.map((output) => [output.path.split("/").at(-1)!, output]));
const js = build.outputs
  .find((output) => output.path.endsWith(".js"))!
  .path.split("/")
  .at(-1)!;
const css = build.outputs
  .find((output) => output.path.endsWith(".css"))!
  .path.split("/")
  .at(-1)!;
const app = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const asset = assets.get(new URL(request.url).pathname.slice(1));
    return asset
      ? new Response(asset)
      : new Response(
          `<html><head><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script type="module" src="/${js}"></script></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
  },
});
const browser = await openTestBrowser();
try {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const page = await browser.attach(targetId);
  await page.command("Page.navigate", { url: `http://localhost:${app.port}/` });
  await eventually(
    () => page.evaluate("!!document.getElementById('success')"),
    "notification fixture",
  );
  await page.evaluate(
    "document.getElementById('success').click();document.getElementById('warning').click();document.getElementById('failure').click()",
  );
  await eventually(
    () => page.evaluate("document.querySelectorAll('.r3-notification').length === 3"),
    "simultaneous notices without Strict Mode duplicates",
  );
  for (const width of [1440, 820, 390]) {
    await page.command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const fit = await page.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.r3-notification')].map(el => el.getBoundingClientRect());
      return cards.every((r, i) => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (i === 0 || cards[i - 1].bottom <= r.top));
    })()`);
    assert.equal(fit, true, "Notices stack in the viewport outside the clipped, inert source");
  }
  await page.evaluate(
    "document.documentElement.classList.add('dark');document.querySelector('[aria-label=\"Dismiss Agent notified\"]').focus()",
  );
  await Bun.sleep(5200);
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=success]')"),
    true,
    "Keyboard focus pauses success dismissal",
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=error]')"),
    true,
    "Errors remain visible",
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=warning]')"),
    true,
    "Warnings remain visible beyond the success timeout",
  );
  await page.evaluate(
    "document.querySelector('[aria-label=\"Copy fetch command\"]').focus();Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async()=>{throw new Error('Clipboard denied')}}});document.execCommand=()=>false;document.querySelector('[aria-label=\"Copy fetch command\"]').click()",
  );
  await eventually(
    () => page.evaluate("document.body.textContent.includes('Select and copy the command above.')"),
    "clipboard denial leaves a selectable command",
  );
  await eventually(
    () => page.evaluate("!document.querySelector('[data-notification-tone=success]')"),
    "success dismisses after focus leaves",
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=error]')"),
    true,
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=warning]')"),
    true,
    "Success dismissal leaves warnings visible",
  );
  await page.evaluate("document.documentElement.dataset.r3Screenshot='true'");
  assert.equal(
    await page.evaluate(
      "getComputedStyle(document.querySelector('[data-notifications]')).visibility",
    ),
    "hidden",
    "Capture excludes notices",
  );
  await page.evaluate(
    "delete document.documentElement.dataset.r3Screenshot;document.querySelector('[aria-label=\"Dismiss Agent notification failed\"]').click()",
  );
  await eventually(
    () => page.evaluate("!document.querySelector('[data-notification-tone=error]')"),
    "error dismissal",
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('[data-notification-tone=warning]')"),
    true,
    "Dismissing an error leaves the warning until its own dismissal",
  );
  await page.evaluate("document.querySelector('[aria-label=\"Dismiss Review notice\"]').click()");
  await eventually(
    () => page.evaluate("document.querySelectorAll('.r3-notification').length === 0"),
    "warning dismissal",
  );
  await page.evaluate("document.getElementById('success').click()");
  await eventually(
    () => page.evaluate("!!document.querySelector('[data-notification-tone=success]')"),
    "unfocused success appears",
  );
  await eventually(
    () => page.evaluate("!document.querySelector('[data-notification-tone=success]')"),
    "success disappears without a dismiss gesture",
  );
  await page.evaluate("document.getElementById('failure').click()");
  await eventually(
    () => page.evaluate("document.querySelectorAll('.r3-notification').length === 1"),
    "another failure can be shown",
  );
  await page.evaluate("document.getElementById('unmount').click()");
  await eventually(
    () => page.evaluate("document.querySelectorAll('.r3-notification').length === 0"),
    "navigation removes originating notices",
  );
  console.log(
    "Notification acceptance passed: stacking, clipping, mobile fit, automatic success dismissal, focus timing, persistent warnings and errors, clipboard denial, capture exclusion, independent dismissal, and navigation cleanup.",
  );
} finally {
  await browser.close();
  app.stop(true);
}
