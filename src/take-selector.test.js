/**
 * Tests for Take Selector module
 *
 * Tests bad take detection, duplicate grouping, and best take selection
 * using both synthetic data and the real test recording transcript.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzeTakes,
  detectHesitations,
  computePace,
  groupDuplicateTakes,
  textSimilarity,
  selectBestTakes,
  selectTakes,
} from "./take-selector.js";

// ── Hesitation detection ──

describe("Take Selector — detectHesitations", () => {
  it("should detect no hesitations in smooth speech", () => {
    const words = [
      { word: "Hello", start: 0, end: 0.3 },
      { word: "world", start: 0.35, end: 0.7 },
      { word: "today", start: 0.75, end: 1.1 },
    ];
    const result = detectHesitations(words);
    assert.equal(result.count, 0);
  });

  it("should detect a large gap as hesitation", () => {
    const words = [
      { word: "Heavy", start: 0, end: 0.3 },
      { word: "metals", start: 0.35, end: 0.7 },
      { word: "like", start: 0.75, end: 1.0 },
      { word: "lead", start: 4.5, end: 5.0 }, // 3.5 second gap
    ];
    const result = detectHesitations(words);
    assert.equal(result.count, 1);
    assert.equal(result.gaps[0].after, "like");
    assert.equal(result.gaps[0].before, "lead");
    assert.ok(result.gaps[0].gapSeconds > 3);
  });

  it("should respect custom gap threshold", () => {
    const words = [
      { word: "A", start: 0, end: 0.2 },
      { word: "B", start: 1.5, end: 1.7 }, // 1.3s gap
    ];
    assert.equal(detectHesitations(words, 1.0).count, 1);
    assert.equal(detectHesitations(words, 2.0).count, 0);
  });
});

// ── Pace computation ──

describe("Take Selector — computePace", () => {
  it("should return 0 for single word", () => {
    const result = computePace([{ word: "Hi", start: 0, end: 0.5 }]);
    assert.equal(result.wps, 0);
  });

  it("should compute words per second", () => {
    const words = [
      { word: "One", start: 0, end: 0.3 },
      { word: "two", start: 0.5, end: 0.8 },
      { word: "three", start: 1.0, end: 1.3 },
      { word: "four", start: 1.5, end: 1.8 },
    ];
    const result = computePace(words);
    assert.ok(result.wps > 1, "should be over 1 word per second");
    assert.ok(result.varianceRatio < 1, "uniform pace should have low variance");
  });

  it("should detect high variance in irregular pace", () => {
    const words = [
      { word: "A", start: 0, end: 0.2 },
      { word: "B", start: 0.3, end: 0.5 },
      { word: "C", start: 5.0, end: 5.2 }, // huge gap
      { word: "D", start: 5.3, end: 5.5 },
    ];
    const result = computePace(words);
    assert.ok(result.varianceRatio > 1, "irregular pace should have high variance ratio");
  });
});

// ── Text similarity ──

describe("Take Selector — textSimilarity", () => {
  it("should return 1 for identical texts", () => {
    assert.equal(textSimilarity("hello world", "hello world"), 1);
  });

  it("should return 1 for same words different punctuation", () => {
    assert.equal(
      textSimilarity("Are you consuming toxic substances?", "Are you consuming toxic substances"),
      1
    );
  });

  it("should return high similarity for near-duplicates", () => {
    const sim = textSimilarity(
      "Are you unknowingly consuming toxic substances along with your protein shake?",
      "Are you unknowingly consuming toxic chemicals along with your protein shake?"
    );
    assert.ok(sim > 0.8, `similarity ${sim} should be > 0.8`);
  });

  it("should return low similarity for unrelated texts", () => {
    const sim = textSimilarity(
      "Are you consuming toxic substances?",
      "Do you know that heavy metals like lead are dangerous?"
    );
    assert.ok(sim < 0.4, `similarity ${sim} should be < 0.4`);
  });

  it("should handle empty strings", () => {
    assert.equal(textSimilarity("", ""), 1);
    assert.equal(textSimilarity("hello", ""), 0);
  });
});

// ── Bad take analysis ──

describe("Take Selector — analyzeTakes", () => {
  it("should flag short fragments as bad takes", () => {
    const segments = [
      { start: 0, end: 2, text: "Are you?", words: [
        { word: "Are", start: 0, end: 1 },
        { word: "you?", start: 1, end: 2 },
      ]},
    ];
    const result = analyzeTakes(segments);
    assert.ok(result[0].analysis.isBadTake, "2-word fragment should be bad take");
    assert.ok(result[0].analysis.reasons.includes("fragment"));
  });

  it("should flag incomplete sentences", () => {
    const segments = [
      { start: 0, end: 5, text: "What if I told you that 69 percent of all protein supplements", words: [
        { word: "What", start: 0, end: 0.3 },
        { word: "if", start: 0.35, end: 0.5 },
        { word: "I", start: 0.55, end: 0.6 },
        { word: "told", start: 0.65, end: 0.9 },
        { word: "you", start: 0.95, end: 1.1 },
        { word: "that", start: 1.15, end: 1.3 },
        { word: "69", start: 1.35, end: 1.7 },
        { word: "percent", start: 1.75, end: 2.1 },
        { word: "of", start: 2.15, end: 2.3 },
        { word: "all", start: 2.35, end: 2.6 },
        { word: "protein", start: 2.65, end: 3.0 },
        { word: "supplements", start: 3.05, end: 3.5 },
      ]},
    ];
    const result = analyzeTakes(segments);
    assert.ok(result[0].analysis.isBadTake, "sentence without terminal punctuation is bad take");
    assert.ok(result[0].analysis.reasons.includes("incomplete"));
  });

  it("should not flag a clean complete sentence", () => {
    const segments = [
      { start: 0, end: 5, text: "Are you unknowingly consuming toxic substances along with your protein shake?", words: [
        { word: "Are", start: 0, end: 0.3 },
        { word: "you", start: 0.35, end: 0.55 },
        { word: "unknowingly", start: 0.6, end: 1.1 },
        { word: "consuming", start: 1.15, end: 1.6 },
        { word: "toxic", start: 1.65, end: 1.95 },
        { word: "substances", start: 2.0, end: 2.5 },
        { word: "along", start: 2.55, end: 2.8 },
        { word: "with", start: 2.85, end: 3.0 },
        { word: "your", start: 3.05, end: 3.25 },
        { word: "protein", start: 3.3, end: 3.6 },
        { word: "shake?", start: 3.65, end: 4.0 },
      ]},
    ];
    const result = analyzeTakes(segments);
    assert.ok(!result[0].analysis.isBadTake, "clean sentence should not be bad take");
    assert.ok(result[0].analysis.fluencyScore >= 80, "clean sentence should score high");
  });

  it("should detect hesitation in words with large gaps", () => {
    const segments = [
      { start: 80, end: 100, text: "Do you know that heavy metals like lead and arsenic can be in your protein powder?", words: [
        { word: "Do", start: 80, end: 80.3 },
        { word: "you", start: 80.35, end: 80.6 },
        { word: "know", start: 80.65, end: 80.9 },
        { word: "that", start: 80.95, end: 81.1 },
        { word: "heavy", start: 81.15, end: 81.4 },
        { word: "metals", start: 81.45, end: 81.8 },
        { word: "like", start: 81.85, end: 82.1 },
        { word: "lead", start: 85.0, end: 85.3 },  // 2.9s gap = hesitation
        { word: "and", start: 85.35, end: 85.5 },
        { word: "arsenic", start: 85.55, end: 86.0 },
        { word: "can", start: 86.05, end: 86.3 },
        { word: "be", start: 86.35, end: 86.5 },
        { word: "in", start: 86.55, end: 86.65 },
        { word: "your", start: 86.7, end: 86.9 },
        { word: "protein", start: 86.95, end: 87.3 },
        { word: "powder?", start: 87.35, end: 87.8 },
      ]},
    ];
    const result = analyzeTakes(segments);
    assert.ok(result[0].analysis.reasons.includes("hesitation"));
    assert.ok(result[0].analysis.hesitations.length > 0);
  });
});

// ── Duplicate grouping ──

describe("Take Selector — groupDuplicateTakes", () => {
  it("should group similar segments together", () => {
    const segments = [
      { text: "Are you unknowingly consuming toxic substances along with your protein shake?", analysis: {} },
      { text: "Are you unknowingly consuming toxic chemicals along with your protein shake?", analysis: {} },
      { text: "Do you know that heavy metals can be dangerous?", analysis: {} },
    ];
    const groups = groupDuplicateTakes(segments);
    assert.equal(groups.length, 2, "should form 2 groups");
    assert.equal(groups[0].length, 2, "first group should have 2 similar segments");
    assert.equal(groups[1].length, 1, "second group should be solo");
  });

  it("should keep distinct segments separate", () => {
    const segments = [
      { text: "First topic about nutrition.", analysis: {} },
      { text: "Second topic about exercise.", analysis: {} },
      { text: "Third topic about sleep.", analysis: {} },
    ];
    const groups = groupDuplicateTakes(segments);
    assert.equal(groups.length, 3, "all distinct segments should be separate groups");
  });
});

// ── Best take selection ──

describe("Take Selector — selectBestTakes", () => {
  it("should prefer complete over incomplete sentences", () => {
    const groups = [[
      { start: 0, end: 5, text: "What if I told you that...", analysis: { isBadTake: true, reasons: ["incomplete"], fluencyScore: 40 } },
      { start: 10, end: 15, text: "What if I told you that supplements are dangerous?", analysis: { isBadTake: false, reasons: [], fluencyScore: 90 } },
    ]];
    const { bestTakes, discarded } = selectBestTakes(groups);
    assert.equal(bestTakes.length, 1);
    assert.equal(discarded.length, 1);
    assert.ok(bestTakes[0].text.includes("dangerous"), "should pick the complete sentence");
  });

  it("should prefer shorter duration among equally fluent takes", () => {
    const groups = [[
      { start: 0, end: 10, text: "Heavy metals are bad for you.", analysis: { isBadTake: false, reasons: [], fluencyScore: 90 } },
      { start: 20, end: 25, text: "Heavy metals are bad for you.", analysis: { isBadTake: false, reasons: [], fluencyScore: 90 } },
    ]];
    const { bestTakes } = selectBestTakes(groups);
    assert.equal(bestTakes[0].start, 20, "should pick the shorter-duration take");
  });

  it("should discard terrible solo segments", () => {
    const groups = [[
      { start: 0, end: 1, text: "Um", analysis: { isBadTake: true, reasons: ["fragment"], fluencyScore: 20 } },
    ]];
    const { bestTakes, discarded } = selectBestTakes(groups);
    assert.equal(bestTakes.length, 0);
    assert.equal(discarded.length, 1);
  });

  it("should keep a mediocre solo segment when it's the only version", () => {
    const groups = [[
      { start: 0, end: 5, text: "This is a reasonable statement.", analysis: { isBadTake: false, reasons: [], fluencyScore: 70 } },
    ]];
    const { bestTakes, discarded } = selectBestTakes(groups);
    assert.equal(bestTakes.length, 1);
    assert.equal(discarded.length, 0);
  });
});

// ── Full pipeline with real transcript ──

describe("Take Selector — selectTakes (real transcript)", () => {
  it("should process the test recording transcript", async () => {
    const raw = await readFile("data/test-recording-transcript.json", "utf-8");
    const transcript = JSON.parse(raw);

    const result = selectTakes(transcript);

    // The test recording has 7 segments with duplicates
    assert.equal(result.stats.totalSegments, 7, "should process all 7 segments");

    // Should detect some bad takes
    assert.ok(result.stats.badTakes > 0, "should find bad takes");

    // Should discard some duplicates
    assert.ok(result.stats.discarded > 0, "should discard worse duplicates");

    // Should keep fewer segments than the original
    assert.ok(result.stats.kept < result.stats.totalSegments,
      `should keep fewer (${result.stats.kept}) than total (${result.stats.totalSegments})`);

    // The first segment "Are you?" should be discarded (fragment)
    const fragment = result.discarded.find((s) => s.text.trim() === "Are you?");
    assert.ok(fragment, "short fragment 'Are you?' should be discarded");

    // The incomplete "What if I told you that 69.4% of all protein supplements?"
    // should be discarded in favor of the complete version
    const incomplete = result.discarded.find((s) =>
      s.text.includes("protein supplements?") && !s.text.includes("misleading")
    );
    assert.ok(incomplete, "incomplete sentence should be discarded");

    // Best takes should be in chronological order
    for (let i = 1; i < result.bestTakes.length; i++) {
      assert.ok(result.bestTakes[i].start >= result.bestTakes[i - 1].start,
        "best takes should be in chronological order");
    }
  });
});
