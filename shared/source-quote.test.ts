import { expect, test } from "bun:test";
import { sourceQuoteExcerpt } from "./source-quote.ts";

test("source excerpts bound long selections and preserve an exact substring", () => {
  expect(sourceQuoteExcerpt("one\ntwo\nthree\nfour\nfive")).toBe("one\ntwo\nthree\nfour");
  expect(sourceQuoteExcerpt("\n\n  first\n\n  third  \n")).toBe("first\n\n  third");
  expect(sourceQuoteExcerpt("a".repeat(5000))).toBe("a".repeat(2048));
  const unicode = `${"a".repeat(2047)}😀tail`;
  const quote = sourceQuoteExcerpt(unicode);
  expect(quote).toBe("a".repeat(2047));
  expect(unicode.includes(quote)).toBe(true);
});
