import { expect, test } from "bun:test";
import { DraftImageStore, draftImages, saveDraftImageOutput } from "./attachment-drafts.ts";

test("accepted optimization stores the exact preview bytes and rejects stale consent", async () => {
  const output = {
    blob: new Blob(["encoded preview"], { type: "image/png" }),
    width: 100,
    height: 60,
  };
  const ticket = await draftImages.epoch();
  const saved = await saveDraftImageOutput("artifact_output", output, undefined, ticket);
  expect(await (await draftImages.get(saved.attachment.id)).text()).toBe("encoded preview");
  expect(saved.attachment.width).toBe(100);
  await draftImages.clear("artifact_output");
  await expect(saveDraftImageOutput("artifact_output", output, undefined, ticket)).rejects.toThrow(
    "cancelled",
  );
});

// Bun has no IndexedDB; these exercise the explicit memory fallback and its
// revocation behavior. Browser acceptance covers persistent image drafts.
test("memory-only images warn about persistence and deletion revokes pending reads", async () => {
  const store = new DraftImageStore();
  const image = new Blob(["draft bytes"], { type: "image/png" });
  const saved = await store.put("artifact_first", image);
  const retained = await store.put("artifact_second", image);
  expect(saved.persisted).toBe(false);
  expect(await (await store.get(saved.id)).text()).toBe("draft bytes");
  const pending = store.get(saved.id);
  await store.clear("artifact_first");
  await expect(pending).rejects.toThrow("unavailable");
  await expect(store.get(saved.id)).rejects.toThrow("unavailable");
  expect(await (await store.get(retained.id)).text()).toBe("draft bytes");
});

test("logout rejects late draft writes and stale bootstrap completions", async () => {
  const store = new DraftImageStore();
  const image = new Blob(["draft bytes"], { type: "image/png" });
  const ticket = await store.epoch();
  await store.clear();
  await store.resume(ticket);
  await expect(store.put("artifact_first", image)).rejects.toThrow("Sign in");
  await store.resume();
  await expect(store.put("artifact_first", image, undefined, ticket)).rejects.toThrow("cancelled");
  expect((await store.put("artifact_first", image)).persisted).toBe(false);
});
