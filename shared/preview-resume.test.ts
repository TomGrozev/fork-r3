import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { previewResumeKeys } from "./preview-resume.ts";

test("resume hints are deduplicated, bounded, and cannot carry capability IDs or arbitrary text", () => {
  const keys = Array.from({ length: 20 }, () => `r${randomBytes(16).toString("hex")}`);
  expect(previewResumeKeys(keys.join("."))).toEqual(keys.slice(-16));
  expect(previewResumeKeys(`${keys[0]}.${keys[0]}.invalid`)).toEqual([keys[0]]);
  expect(previewResumeKeys(`p${randomBytes(24).toString("hex")}`)).toEqual([]);
  expect(previewResumeKeys("x".repeat(1025))).toEqual([]);
  expect(previewResumeKeys(undefined)).toEqual([]);
});
