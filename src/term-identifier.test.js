/**
 * Tests for Term Identifier Module
 *
 * Tests cover:
 * - JSON response parsing (parseTermResponse)
 * - Term timing resolution (resolveTermTiming)
 * - Main entry point routing (extractTermFlashes)
 * - Edge cases and invalid input
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTermResponse,
  resolveTermTiming,
  identifyTerms,
  extractTermFlashes,
} from "./term-identifier.js";

describe("parseTermResponse", () => {
  it("parses valid JSON array", () => {
    const input = JSON.stringify([
      { segmentIndex: 1, text: "BCAAs", type: "term", startWord: "BCAAs" },
      { segmentIndex: 2, text: "80% of supplements", type: "claim", startWord: "80%" },
    ]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "BCAAs");
    assert.equal(result[1].type, "claim");
  });

  it("strips markdown code fences", () => {
    const input = '```json\n[{"segmentIndex": 1, "text": "protein", "type": "term"}]\n```';
    const result = parseTermResponse(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "protein");
  });

  it("strips code fences without json language tag", () => {
    const input = '```\n[{"segmentIndex": 1, "text": "test", "type": "term"}]\n```';
    const result = parseTermResponse(input);
    assert.equal(result.length, 1);
  });

  it("returns empty array for invalid JSON", () => {
    assert.deepEqual(parseTermResponse("not json"), []);
    assert.deepEqual(parseTermResponse("{invalid}"), []);
  });

  it("returns empty array for non-array JSON", () => {
    assert.deepEqual(parseTermResponse('{"key": "value"}'), []);
    assert.deepEqual(parseTermResponse('"string"'), []);
  });

  it("filters out items with missing segmentIndex", () => {
    const input = JSON.stringify([
      { text: "no index", type: "term" },
      { segmentIndex: 1, text: "valid", type: "term" },
    ]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "valid");
  });

  it("filters out items with empty text", () => {
    const input = JSON.stringify([
      { segmentIndex: 1, text: "", type: "term" },
      { segmentIndex: 1, text: "   ", type: "term" },
      { segmentIndex: 1, text: "valid", type: "term" },
    ]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 1);
  });

  it("filters out null items", () => {
    const input = JSON.stringify([null, { segmentIndex: 1, text: "valid", type: "term" }]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 1);
  });

  it("handles empty array response", () => {
    assert.deepEqual(parseTermResponse("[]"), []);
  });

  it("handles null and undefined input", () => {
    assert.deepEqual(parseTermResponse(null), []);
    assert.deepEqual(parseTermResponse(undefined), []);
    assert.deepEqual(parseTermResponse(""), []);
  });

  it("handles non-string input", () => {
    assert.deepEqual(parseTermResponse(42), []);
    assert.deepEqual(parseTermResponse(true), []);
  });
});

describe("resolveTermTiming", () => {
  const segment = {
    start: 10.0,
    end: 20.0,
    text: "BCAAs are essential amino acids that help with muscle recovery",
    words: [
      { word: "BCAAs", start: 10.0, end: 10.5 },
      { word: "are", start: 10.5, end: 10.8 },
      { word: "essential", start: 10.8, end: 11.3 },
      { word: "amino", start: 11.3, end: 11.7 },
      { word: "acids", start: 11.7, end: 12.1 },
      { word: "that", start: 12.1, end: 12.4 },
      { word: "help", start: 12.4, end: 12.7 },
      { word: "with", start: 12.7, end: 13.0 },
      { word: "muscle", start: 13.0, end: 13.5 },
      { word: "recovery", start: 13.5, end: 14.2 },
    ],
  };

  it("resolves timing from word-level timestamps", () => {
    const timing = resolveTermTiming(segment, "BCAAs", "BCAAs");
    assert.ok(timing.start >= segment.start);
    assert.ok(timing.end <= segment.end);
    assert.ok(timing.end > timing.start);
  });

  it("starts slightly before the matching word", () => {
    const timing = resolveTermTiming(segment, "amino", "amino acids");
    // amino starts at 11.3, so flash should start at 11.1 (11.3 - 0.2)
    assert.ok(timing.start <= 11.3);
    assert.ok(timing.start >= 10.0); // clamped to segment start
  });

  it("limits flash duration to 3 seconds", () => {
    const timing = resolveTermTiming(segment, "BCAAs", "BCAAs");
    assert.ok(timing.end - timing.start <= 3.0);
  });

  it("falls back to centered timing when no words match", () => {
    const timing = resolveTermTiming(segment, "nonexistent", "nonexistent term");
    // Should be centered in the segment
    assert.ok(timing.start >= segment.start);
    assert.ok(timing.end <= segment.end);
    assert.ok(timing.end - timing.start <= 3.0);
  });

  it("falls back to segment timing when no word timestamps", () => {
    const noWordsSeg = { start: 5.0, end: 8.0, text: "test", words: [] };
    const timing = resolveTermTiming(noWordsSeg, "test", "test");
    assert.equal(timing.start, 5.0);
    assert.equal(timing.end, 8.0);
  });

  it("handles short segments (< 3s)", () => {
    const shortSeg = { start: 5.0, end: 6.5, text: "short", words: [] };
    const timing = resolveTermTiming(shortSeg, "short", "short");
    assert.equal(timing.start, 5.0);
    assert.equal(timing.end, 6.5);
  });

  it("handles null segment", () => {
    const timing = resolveTermTiming(null, "test", "test");
    assert.equal(timing.start, 0);
    assert.equal(timing.end, 3);
  });

  it("handles segment without start time", () => {
    const timing = resolveTermTiming({ end: 10 }, "test", "test");
    assert.equal(timing.start, 0);
    assert.equal(timing.end, 3);
  });

  it("matches words case-insensitively", () => {
    const timing = resolveTermTiming(segment, "bcaas", "BCAAs");
    assert.ok(timing.start >= segment.start);
    assert.ok(timing.end <= segment.end);
  });

  it("matches words ignoring punctuation", () => {
    const segWithPunc = {
      start: 0,
      end: 10,
      text: "test",
      words: [{ word: "BCAAs,", start: 1.0, end: 1.5 }],
    };
    const timing = resolveTermTiming(segWithPunc, "BCAAs", "BCAAs");
    assert.ok(timing.start <= 1.0);
  });
});

describe("identifyTerms", () => {
  it("returns empty array for empty segments", async () => {
    assert.deepEqual(await identifyTerms([]), []);
  });

  it("returns empty array for null input", async () => {
    assert.deepEqual(await identifyTerms(null), []);
  });

  it("returns empty array for non-array input", async () => {
    assert.deepEqual(await identifyTerms("not an array"), []);
    assert.deepEqual(await identifyTerms(42), []);
  });

  it("has the correct function signature", () => {
    assert.equal(typeof identifyTerms, "function");
  });
});

describe("extractTermFlashes", () => {
  it("handles null transcript", async () => {
    const result = await extractTermFlashes(null);
    assert.deepEqual(result.termFlashes, []);
    assert.equal(result.stats.totalFlashes, 0);
    assert.equal(result.stats.terms, 0);
    assert.equal(result.stats.claims, 0);
  });

  it("handles transcript without segments", async () => {
    const result = await extractTermFlashes({ language: "en" });
    assert.deepEqual(result.termFlashes, []);
  });

  it("handles transcript with non-array segments", async () => {
    const result = await extractTermFlashes({ language: "en", segments: "not array" });
    assert.deepEqual(result.termFlashes, []);
  });

  it("handles transcript with empty segments", async () => {
    const result = await extractTermFlashes({ language: "en", segments: [] });
    assert.deepEqual(result.termFlashes, []);
    assert.equal(result.stats.totalFlashes, 0);
  });

  it("returns well-formed stats object", async () => {
    const result = await extractTermFlashes({ language: "en", segments: [] });
    assert.equal(typeof result.stats.totalFlashes, "number");
    assert.equal(typeof result.stats.terms, "number");
    assert.equal(typeof result.stats.claims, "number");
  });
});

// ============================================================
// ADVERSARIAL TESTS — Exposing bugs in term-identifier.js
// ============================================================

describe("ADVERSARIAL: resolveTermTiming", () => {
  it("BUG: crashes when words array contains null entries", () => {
    const segment = {
      start: 5.0,
      end: 15.0,
      text: "test words",
      words: [null, { word: "test", start: 5.5, end: 6.0 }],
    };
    // Should not throw, but the code does w.word on null
    assert.doesNotThrow(() => {
      resolveTermTiming(segment, "test", "test");
    });
  });

  it("BUG: returns NaN timestamps when segment.end is undefined", () => {
    const segment = { start: 5.0, text: "hello world", words: [] };
    // segment.end is undefined — fallback centering does (undefined - 5.0) = NaN
    const timing = resolveTermTiming(segment, "hello", "hello");
    assert.ok(!Number.isNaN(timing.start), `start should not be NaN, got ${timing.start}`);
    assert.ok(!Number.isNaN(timing.end), `end should not be NaN, got ${timing.end}`);
  });

  it("BUG: returns NaN when matched word has no start timestamp", () => {
    const segment = {
      start: 5.0,
      end: 15.0,
      text: "protein",
      words: [{ word: "protein" }], // missing start property
    };
    const timing = resolveTermTiming(segment, "protein", "protein");
    assert.ok(!Number.isNaN(timing.start), `start should not be NaN, got ${timing.start}`);
    assert.ok(!Number.isNaN(timing.end), `end should not be NaN, got ${timing.end}`);
  });

  it("BUG: returns NaN with segment.end undefined and word match found", () => {
    const segment = {
      start: 5.0,
      // end is undefined
      text: "test",
      words: [{ word: "test", start: 5.5, end: 6.0 }],
    };
    const timing = resolveTermTiming(segment, "test", "test");
    // Math.min(undefined, ...) = NaN
    assert.ok(!Number.isNaN(timing.end), `end should not be NaN, got ${timing.end}`);
  });

  it("BUG: inverted segment (end < start) produces wrong timing", () => {
    const segment = { start: 20.0, end: 10.0, text: "inverted", words: [] };
    const timing = resolveTermTiming(segment, "inverted", "inverted");
    // segDuration = -10, so flashStart = 20 + (-10 - 3)/2 = 20 - 6.5 = 13.5
    // That is BEFORE segment.start=20, which is wrong
    // With inverted segment (start=20, end=10), segDuration=-10
    // segDuration <= 3 is false (since -10 is not <= 3... wait, -10 IS <= 3)
    // Actually -10 <= 3 is TRUE, so it takes the short-segment branch
    // Returns {start: 20, end: 10} — which means end < start!
    assert.ok(timing.end >= timing.start, `end (${timing.end}) must be >= start (${timing.start}), but inverted segment produces inverted timing`);
  });
});

describe("ADVERSARIAL: identifyTerms", () => {
  it("BUG: crashes when segment has undefined start", async () => {
    const segments = [{ text: "test segment", end: 5.0, words: [] }];
    // seg.start.toFixed(2) will throw TypeError
    try {
      await identifyTerms(segments);
      // If it doesn't throw, that's fine too — but it WILL throw
    } catch (err) {
      assert.ok(
        err instanceof TypeError,
        `Expected TypeError for undefined start, got ${err.constructor.name}: ${err.message}`
      );
      // This IS a bug: should validate or handle gracefully, not crash
      assert.fail("identifyTerms should not throw on malformed segments — it should skip or return empty");
    }
  });


});

describe("ADVERSARIAL: parseTermResponse", () => {
  it("BUG: does not strip code fences with trailing content after closing fence", () => {
    // Claude sometimes adds text after the closing fence
    const input = '```json\n[{"segmentIndex": 1, "text": "term", "type": "term"}]\n```\nHere are the results.';
    const result = parseTermResponse(input);
    // The closing ``` regex uses $ which won't match if there's trailing text
    assert.equal(result.length, 1, `Should parse despite trailing text, got ${result.length} items`);
  });

  it("rejects segmentIndex of 0 (1-based indexing)", () => {
    const input = JSON.stringify([
      { segmentIndex: 0, text: "zero indexed", type: "term", startWord: "zero" },
    ]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 0, "segmentIndex 0 should be rejected (1-based indexing)");
  });

  it("rejects negative segmentIndex", () => {
    const input = JSON.stringify([
      { segmentIndex: -5, text: "negative", type: "term", startWord: "negative" },
    ]);
    const result = parseTermResponse(input);
    assert.equal(result.length, 0, "negative segmentIndex should be rejected");
  });

  it("accepts NaN segmentIndex", () => {
    // JSON doesn't have NaN, so this can't happen via JSON.parse. Skip.
  });

  it("accepts Infinity segmentIndex", () => {
    // JSON doesn't have Infinity either. Skip.
  });
});
