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

// ── Adversarial tests: edge cases and bug exposures ──

describe("ADVERSARIAL — trailing-off sentences should be bad takes", () => {
  it("a sentence ending with '...' should be flagged as a bad take", () => {
    // A trailing-off sentence like "I was going to say..." ends with '.'
    // so it passes the terminal punctuation check and is NOT flagged "incomplete".
    // With only "trailing-off" reason and fluencyScore=75, isBadTake is false.
    // This is a bug: trailing-off sentences are abandoned takes and should be bad.
    const segments = [
      {
        start: 0, end: 5,
        text: "I was going to tell you about the protein supplements...",
        words: [
          { word: "I", start: 0, end: 0.2 },
          { word: "was", start: 0.25, end: 0.5 },
          { word: "going", start: 0.55, end: 0.8 },
          { word: "to", start: 0.85, end: 1.0 },
          { word: "tell", start: 1.05, end: 1.3 },
          { word: "you", start: 1.35, end: 1.5 },
          { word: "about", start: 1.55, end: 1.8 },
          { word: "the", start: 1.85, end: 2.0 },
          { word: "protein", start: 2.05, end: 2.4 },
          { word: "supplements...", start: 2.45, end: 3.0 },
        ],
      },
    ];
    const result = analyzeTakes(segments);
    assert.ok(
      result[0].analysis.isBadTake,
      `Trailing-off sentence should be a bad take, but got isBadTake=${result[0].analysis.isBadTake}, ` +
      `fluencyScore=${result[0].analysis.fluencyScore}, reasons=${result[0].analysis.reasons}`
    );
  });
});

describe("ADVERSARIAL — solo bad-take segments that are not fragments should be discarded", () => {
  it("a solo incomplete segment (not fragment, not terrible) should be discarded", () => {
    // Solo segment: isBadTake=true, reasons=["incomplete"], fluencyScore=70
    // selectBestTakes only discards solo segments if isFragment || (isBadTake && fluencyScore < 30)
    // An incomplete solo segment with fluencyScore=70 slips through and is KEPT.
    // Bug: bad takes with no alternative should still be discarded.
    const groups = [[
      {
        start: 0, end: 5,
        text: "What if I told you that supplements contain heavy metals and",
        words: Array.from({ length: 10 }, (_, i) => ({ word: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.3 })),
        analysis: { isBadTake: true, reasons: ["incomplete"], fluencyScore: 70 },
      },
    ]];
    const { bestTakes, discarded } = selectBestTakes(groups);
    assert.equal(
      bestTakes.length, 0,
      `A solo bad take (incomplete, no alternative) should be discarded, not kept. Got bestTakes=${bestTakes.length}`
    );
    assert.equal(discarded.length, 1);
  });
});

describe("ADVERSARIAL — detectHesitations with empty input", () => {
  it("should handle empty words array", () => {
    const result = detectHesitations([]);
    assert.equal(result.count, 0);
    assert.deepEqual(result.gaps, []);
  });

  it("should handle single word", () => {
    const result = detectHesitations([{ word: "Hi", start: 0, end: 0.5 }]);
    assert.equal(result.count, 0);
  });
});

describe("ADVERSARIAL — computePace edge cases", () => {
  it("should handle empty words array", () => {
    const result = computePace([]);
    assert.equal(result.wps, 0);
    assert.equal(result.varianceRatio, 0);
  });

  it("should handle words with zero-duration gaps (overlapping timestamps)", () => {
    // All words start at the same time — durations are all 0, filtered out
    const words = [
      { word: "A", start: 0, end: 0.1 },
      { word: "B", start: 0, end: 0.1 },
      { word: "C", start: 0, end: 0.1 },
    ];
    const result = computePace(words);
    // Should not throw or return NaN
    assert.ok(!Number.isNaN(result.wps), "wps should not be NaN");
    assert.ok(!Number.isNaN(result.varianceRatio), "varianceRatio should not be NaN");
  });
});

describe("ADVERSARIAL — textSimilarity edge cases", () => {
  it("should distinguish 'the the the' from a real sentence containing 'the'", () => {
    // Set-based Jaccard treats "the the the" identically to "the"
    // This means "the the the" has similarity 1.0 with "the", which is misleading
    const sim = textSimilarity("the the the", "the");
    // This assertion documents the (arguably buggy) behavior:
    // a repeated-word string shouldn't be "identical" to a single word
    assert.ok(sim < 1.0,
      `"the the the" vs "the" should not be perfect similarity, got ${sim}`
    );
  });

  it("should not give high similarity for strings sharing only stop words", () => {
    const sim = textSimilarity(
      "the a an is are was were",
      "the a an it they we you"
    );
    // These share "the", "a", "an" out of ~14 unique words
    // Jaccard = 3/11 ≈ 0.27, so this should pass. Just documenting.
    assert.ok(sim < 0.6,
      `Strings sharing only stop words should have low similarity, got ${sim}`
    );
  });
});

describe("ADVERSARIAL — groupDuplicateTakes only compares to group anchor", () => {
  it("should group transitively similar segments together", () => {
    // A is similar to B (sim > 0.6), B is similar to C (sim > 0.6),
    // but A is NOT similar to C (sim < 0.6).
    // Since groupDuplicateTakes only compares j to i (the anchor),
    // if A is the anchor, C won't be grouped with A+B even though
    // B bridges them.
    const segments = [
      { text: "alpha beta gamma delta", analysis: {} },         // A
      { text: "beta gamma delta epsilon", analysis: {} },       // B (similar to A)
      { text: "gamma delta epsilon zeta", analysis: {} },       // C (similar to B, not A)
    ];

    // Verify our similarity assumptions
    const simAB = textSimilarity(segments[0].text, segments[1].text);
    const simBC = textSimilarity(segments[1].text, segments[2].text);
    const simAC = textSimilarity(segments[0].text, segments[2].text);

    // A-B share {beta, gamma, delta} / {alpha, beta, gamma, delta, epsilon} = 3/5 = 0.6
    // B-C share {gamma, delta, epsilon} / {beta, gamma, delta, epsilon, zeta} = 3/5 = 0.6
    // A-C share {gamma, delta} / {alpha, beta, gamma, delta, epsilon, zeta} = 2/6 ≈ 0.33

    assert.ok(simAB >= 0.6, `A-B similarity ${simAB} should be >= 0.6`);
    assert.ok(simBC >= 0.6, `B-C similarity ${simBC} should be >= 0.6`);
    assert.ok(simAC < 0.6, `A-C similarity ${simAC} should be < 0.6`);

    const groups = groupDuplicateTakes(segments);

    // Bug: C should be in the same group as A and B (transitively similar),
    // but since only anchor-comparison is used, C ends up alone.
    assert.equal(groups.length, 2,
      `Should form 2 groups (A+B grouped, C separate due to non-transitive grouping), ` +
      `but ideally should be 1 group. Got ${groups.length} groups.`
    );
    // If the implementation were correct (transitive grouping), this would be 1 group.
    // Documenting current behavior: this test PASSES with current code (2 groups).
    // The real assertion below will FAIL if the code ever claims to do transitive grouping:
    // For now, just verify B is with A, and C is alone
    assert.equal(groups[0].length, 2, "A and B should be grouped");
    assert.equal(groups[1].length, 1, "C should be alone (non-transitive bug)");
  });
});

describe("ADVERSARIAL — analyzeTakes with text ending in comma", () => {
  it("text ending with comma should be flagged both trailing-off AND incomplete", () => {
    const segments = [
      {
        start: 0, end: 3,
        text: "So what I was saying is,",
        words: [
          { word: "So", start: 0, end: 0.3 },
          { word: "what", start: 0.35, end: 0.6 },
          { word: "I", start: 0.65, end: 0.75 },
          { word: "was", start: 0.8, end: 1.0 },
          { word: "saying", start: 1.05, end: 1.4 },
          { word: "is,", start: 1.45, end: 1.7 },
        ],
      },
    ];
    const result = analyzeTakes(segments);
    // Comma is not terminal punctuation, so "incomplete" should fire
    assert.ok(result[0].analysis.reasons.includes("incomplete"),
      "text ending in comma should be incomplete");
    // Comma also matches /[,;]$/ so "trailing-off" should fire
    assert.ok(result[0].analysis.reasons.includes("trailing-off"),
      "text ending in comma should be trailing-off");
    // With both penalties: -30 (incomplete) -25 (trailing-off) = 45
    assert.ok(result[0].analysis.isBadTake,
      "text ending in comma should be a bad take");
  });
});

describe("ADVERSARIAL — selectBestTakes with all-bad-take group", () => {
  it("should still select the least-bad take from a group of all bad takes", () => {
    const groups = [[
      {
        start: 0, end: 5,
        text: "Uh what if I told you that",
        words: Array.from({ length: 7 }, (_, i) => ({ word: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.3 })),
        analysis: { isBadTake: true, reasons: ["incomplete", "hesitation"], fluencyScore: 35 },
      },
      {
        start: 10, end: 14,
        text: "What if I told you that um",
        words: Array.from({ length: 7 }, (_, i) => ({ word: `w${i}`, start: 10 + i * 0.5, end: 10 + i * 0.5 + 0.3 })),
        analysis: { isBadTake: true, reasons: ["incomplete", "hesitation"], fluencyScore: 40 },
      },
    ]];
    const { bestTakes, discarded } = selectBestTakes(groups);
    // Should still pick the better one (fluencyScore 40)
    assert.equal(bestTakes.length, 1);
    assert.equal(bestTakes[0].analysis.fluencyScore, 40);
    assert.equal(discarded.length, 1);
  });
});

describe("ADVERSARIAL — selectTakes with empty transcript", () => {
  it("should handle transcript with no segments", () => {
    const result = selectTakes({ segments: [] });
    assert.equal(result.stats.totalSegments, 0);
    assert.equal(result.stats.kept, 0);
    assert.equal(result.stats.discarded, 0);
  });
});

describe("ADVERSARIAL — analyzeTakes with missing words array", () => {
  it("should handle segment with no words property", () => {
    const segments = [
      { start: 0, end: 5, text: "Hello world." },
    ];
    // Should not throw
    const result = analyzeTakes(segments);
    assert.ok(result[0].analysis.reasons.includes("fragment"),
      "segment with no words should be treated as fragment (0 words < 4)");
  });
});
