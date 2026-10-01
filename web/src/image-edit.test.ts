import { expect, test } from "bun:test";
import { mapImageCrop } from "./image-edit.ts";

test("re-cropping a resized capture retains its original pixel coordinates", () => {
  const original = { x: 100, y: 200, width: 1000, height: 600 };
  const displayed = { width: 500, height: 300 };
  expect(mapImageCrop({ x: 25, y: 50, width: 100, height: 75 }, displayed, original)).toEqual({
    x: 150,
    y: 300,
    width: 200,
    height: 150,
  });
  expect(mapImageCrop({ x: 0, y: 0, ...displayed }, displayed, original)).toEqual(original);
});
