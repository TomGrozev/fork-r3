import { expect, test } from "bun:test";
import { ArtifactDraftStore } from "./artifact-drafts.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("draft target and reply context remain on their original publication while the pane moves", () => {
  const disk = storage();
  const store = new ArtifactDraftStore(disk);
  const original = {
    kind: "rendered" as const,
    path: "index.md",
    versionSeq: 1,
    locator: { selector: "a", quote: "Link" },
  };
  expect(store.anchor("artifact_example", original)).toBe(true);
  store.update("artifact_example", { body: "A note about this link" });
  expect(store.anchor("artifact_example", { ...original, versionSeq: 2 })).toBe(false);
  store.beginReply("artifact_example", "feedback_example", {
    versionSeq: 1,
    representation: "rendered",
  });
  store.update("artifact_example", { body: "Reply about v1" }, "feedback_example");
  store.beginReply("artifact_example", "feedback_example", {
    versionSeq: 2,
    representation: "source",
  });
  store.flush();
  const reloaded = new ArtifactDraftStore(disk);
  expect(reloaded.get("artifact_example")?.target).toEqual(original);
  expect(reloaded.get("artifact_example", "feedback_example")?.context).toEqual({
    versionSeq: 1,
    representation: "rendered",
  });
  expect(reloaded.has("artifact_example")).toBe(true);
});
test("legacy draft text survives without inventing a publication target or reappearing after it was cleared", () => {
  const disk = storage();
  disk.setItem(
    "r3-draft-review_imported",
    JSON.stringify({
      general: "Saved note",
      text: "Anchored draft",
      anchor: { file: "notes.md", lineStart: 2 },
      replies: { feedback_old: "Old reply" },
    }),
  );
  const store = new ArtifactDraftStore(disk);
  expect(store.get("review_imported")?.body).toContain("Anchored draft");
  expect(store.get("review_imported")?.imported).toBe(true);
  expect(store.get("review_imported")?.target).toEqual({ kind: "artifact" });
  expect(store.get("review_imported", "feedback_old")?.context.versionSeq).toBeNull();
  store.clear("review_imported");
  store.clear("review_imported", "feedback_old");
  store.flush();
  expect(new ArtifactDraftStore(disk).has("review_imported")).toBe(false);
  expect(disk.getItem("r3-draft-review_imported")).not.toBeNull();
});

test("deleted threads cannot leave an invisible draft blocking handoff", () => {
  const disk = storage();
  const store = new ArtifactDraftStore(disk);
  store.update("artifact_example", { body: "Keep this note" });
  store.update("artifact_example", { body: "Deleted thread reply" }, "feedback_deleted");
  store.update("artifact_example", { body: "Resolved thread reply" }, "feedback_resolved");
  store.pruneReplies("artifact_example", new Set(["feedback_resolved"]));
  store.flush();
  const reloaded = new ArtifactDraftStore(disk);
  expect(reloaded.count("artifact_example")).toBe(2);
  expect(reloaded.get("artifact_example", "feedback_deleted")).toBeNull();
  expect(reloaded.get("artifact_example", "feedback_resolved")?.body).toBe("Resolved thread reply");
});

test("a completed save cannot discard a newer note or reply draft, including edit and revert", () => {
  const disk = storage();
  const store = new ArtifactDraftStore(disk);
  for (const replyTo of [undefined, "feedback_example"]) {
    store.update("artifact_example", { body: "Submitted text" }, replyTo);
    const submitted = store.get("artifact_example", replyTo)!;
    store.update("artifact_example", { body: "New text" }, replyTo);
    expect(store.clearIfCurrent("artifact_example", submitted, replyTo)).toBe(false);
    expect(store.get("artifact_example", replyTo)?.body).toBe("New text");
    store.update("artifact_example", { body: "Submitted text" }, replyTo);
    expect(store.clearIfCurrent("artifact_example", submitted, replyTo)).toBe(false);
  }
  store.flush();
  const reloaded = new ArtifactDraftStore(disk);
  expect(reloaded.get("artifact_example")?.body).toBe("Submitted text");
  expect(reloaded.get("artifact_example", "feedback_example")?.body).toBe("Submitted text");
});

test("a completed save clears its unchanged draft while preserving other draft slots", () => {
  const store = new ArtifactDraftStore(storage());
  store.update("artifact_example", { body: "Submitted note" });
  const submitted = store.get("artifact_example")!;
  store.update("artifact_example", { body: "Independent reply" }, "feedback_example");
  expect(store.clearIfCurrent("artifact_example", submitted)).toBe(true);
  expect(store.get("artifact_example")).toBeNull();
  expect(store.get("artifact_example", "feedback_example")?.body).toBe("Independent reply");
  const reply = store.get("artifact_example", "feedback_example")!;
  expect(store.clearIfCurrent("artifact_example", reply, "feedback_example")).toBe(true);
  store.flush();
});
