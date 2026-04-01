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
