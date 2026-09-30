import { expect, test } from "bun:test";
import { imageMessageBody, insertImagePlaceholders } from "./image-placeholders.ts";

test("image paste replaces the selection with spaced message-local labels", () => {
  expect(insertImagePlaceholders("beforeAFTER", 1, 2, { start: 6, end: 6 })).toEqual({
    body: "before [image1] [image2] AFTER",
    caret: 25,
  });
  expect(insertImagePlaceholders("left selected right", 2, 1, { start: 5, end: 13 })).toEqual({
    body: "left [image2] right",
    caret: 14,
  });
  expect(insertImagePlaceholders("", 1, 1)).toEqual({ body: " [image1] ", caret: 10 });
  expect(insertImagePlaceholders("text", 1, 1)).toEqual({ body: "text [image1] ", caret: 14 });
});

test("mixed clipboard text stays with the image at the selected cursor position", () => {
  expect(insertImagePlaceholders("leftright", 1, 1, { start: 4, end: 4, text: " pasted" })).toEqual(
    {
      body: "left pasted [image1] right",
      caret: 21,
    },
  );
});

test("removing an earlier attachment renumbers all references without moving other text", () => {
  const before = [{ id: "first" }, { id: "second" }, { id: "third" }];
  expect(
    imageMessageBody(
      "Compare [image1] with [image2]. Keep [image3] and [image2].",
      before,
      before.slice(1),
    ),
  ).toBe("Compare  with [image1]. Keep [image2] and [image1].");
  expect(imageMessageBody(" [image1] ", before.slice(0, 1), [])).toBe("  ");
  expect(imageMessageBody("[image9] is plain text", before, [])).toBe("[image9] is plain text");
});

test("image normalization and editing preserve labels and text typed during preparation", () => {
  expect(imageMessageBody(" [image1] typed later", [{ id: "pending" }], [{ id: "ready" }])).toBe(
    " [image1] typed later",
  );
  expect(imageMessageBody("Note", [], [{ id: "capture" }])).toBe("Note [image1] ");
});
