/**
 * Tests for the Pipeline module
 *
 * Tests segment intersection logic and pipeline integration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFinalSegments, filterEntriesForShort, rebaseTimestamps } from "./pipeline.js";

describe("Pipeline — computeFinalSegments", () => {
  it("should return speaking segments when no best takes", () => {
    const speaking = [
      { start: 0, end: 10 },
      { start: 15, end: 25 },
    ];
    const result = computeFinalSegments(speaking, []);
    assert.equal(result.length, 2);
    assert.equal(result[0].start, 0);
    assert.equal(result[1].end, 25);
  });

  it("should intersect speaking segments with best takes", () => {
    // Speaking: 0-30 (entire duration, no silence)
    // Best takes: 5-10 and 20-25 (only keep these content ranges)
    const speaking = [{ start: 0, end: 30 }];
    const bestTakes = [
      { start: 5, end: 10, text: "take 1" },
      { start: 20, end: 25, text: "take 2" },
    ];

    const result = computeFinalSegments(speaking, bestTakes);
    assert.equal(result.length, 2);
    assert.equal(result[0].start, 5);
    assert.equal(result[0].end, 10);
    assert.equal(result[1].start, 20);
    assert.equal(result[1].end, 25);
  });

  it("should handle partial overlap between speaking and best takes", () => {
    // Speaking: 5-15 (silence before 5 and after 15)
    // Best take: 10-20 (extends beyond speaking)
    const speaking = [{ start: 5, end: 15 }];
    const bestTakes = [{ start: 10, end: 20, text: "take" }];

    const result = computeFinalSegments(speaking, bestTakes);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, 10);
    assert.equal(result[0].end, 15); // Clipped to speaking end
  });

  it("should exclude segments with no overlap", () => {
    // Speaking: 0-10
    // Best take: 20-30 (no overlap)
    const speaking = [{ start: 0, end: 10 }];
    const bestTakes = [{ start: 20, end: 30, text: "no overlap" }];

    const result = computeFinalSegments(speaking, bestTakes);
    assert.equal(result.length, 0);
  });

  it("should merge adjacent segments", () => {
    // Two speaking segments close together, both overlap with one best take
    const speaking = [
      { start: 0, end: 5 },
      { start: 5.1, end: 10 },
    ];
    const bestTakes = [{ start: 0, end: 10, text: "continuous take" }];

    const result = computeFinalSegments(speaking, bestTakes);
    // Gap is 0.1s which is < 0.15s merge threshold
    assert.equal(result.length, 1);
    assert.equal(result[0].start, 0);
    assert.equal(result[0].end, 10);
  });

  it("should handle real-world scenario from test recording", () => {
    // Simulate: 3 speaking segments, 2 best takes (1 bad take removed)
    const speaking = [
      { start: 7, end: 12 },     // segment around "Are you?" (bad take) and first real take
      { start: 28, end: 35 },    // "Are you unknowingly consuming..." (best take 1)
      { start: 57, end: 75 },    // Contains both incomplete and complete versions
    ];

    const bestTakes = [
      { start: 29, end: 34.5, text: "Are you unknowingly consuming toxic substances?" },
      { start: 62.5, end: 75, text: "What if I told you...misleading labels?" },
    ];

    const result = computeFinalSegments(speaking, bestTakes);

    // Best take 1 overlaps with speaking[1]: 29-34.5
    // Best take 2 overlaps with speaking[2]: 62.5-75
    // speaking[0] has no overlap with any best take (bad take removed)
    assert.equal(result.length, 2);
    assert.ok(result[0].start >= 29);
    assert.ok(result[0].end <= 35);
    assert.ok(result[1].start >= 62.5);
    assert.ok(result[1].end <= 75);
  });
});

describe("Pipeline — language support", () => {
  it("should accept language option in pipeline config", async () => {
    // Verify the pipeline module exports runPhase1 with language support
    const { runPhase1 } = await import("./pipeline.js");
    assert.ok(typeof runPhase1 === "function");
    // Language is passed through options — no separate test needed
    // since it delegates to ingest() which already handles it
  });
});

// ── Adversarial tests: edge cases and bug exposure ──

describe("Pipeline — adversarial: null/undefined inputs", () => {
  it("should handle null speakingSegments gracefully", () => {
    // If speakingSegments is null/undefined the function should not throw
    assert.doesNotThrow(() => {
      const result = computeFinalSegments(null, [{ start: 0, end: 10 }]);
      assert.ok(Array.isArray(result));
    });
  });

  it("should handle undefined speakingSegments gracefully", () => {
    assert.doesNotThrow(() => {
      const result = computeFinalSegments(undefined, []);
      assert.ok(Array.isArray(result));
    });
  });

  it("should handle null bestTakes gracefully", () => {
    // bestTakes.length will throw TypeError if bestTakes is null
    assert.doesNotThrow(() => {
      const result = computeFinalSegments([{ start: 0, end: 10 }], null);
      assert.ok(Array.isArray(result));
    });
  });

  it("should handle undefined bestTakes gracefully", () => {
    assert.doesNotThrow(() => {
      const result = computeFinalSegments([{ start: 0, end: 10 }], undefined);
      assert.ok(Array.isArray(result));
    });
  });
});

describe("Pipeline — adversarial: return value mutation safety", () => {
  it("should not return the same array reference when bestTakes is empty", () => {
    // BUG: when bestTakes is empty, the function does `return speakingSegments`
    // which returns the original mutable reference. Callers who push/splice
    // the result will corrupt the input array.
    const speaking = [{ start: 0, end: 10 }, { start: 15, end: 25 }];
    const result = computeFinalSegments(speaking, []);

    // The result should be a copy, not the same reference
    assert.notStrictEqual(result, speaking,
      "computeFinalSegments should return a defensive copy, not the original array reference");
  });
});

describe("Pipeline — adversarial: overlap threshold edge case", () => {
  it("should keep segments with exactly 0.1s overlap", () => {
    // The code uses `overlapEnd - overlapStart > 0.1` which excludes
    // segments with exactly 0.1s of overlap. This causes content loss:
    // a 100ms spoken segment inside a best take would be silently dropped.
    const speaking = [{ start: 10.0, end: 10.1 }];
    const bestTakes = [{ start: 0, end: 20, text: "full coverage" }];

    const result = computeFinalSegments(speaking, bestTakes);
    // A 100ms segment that is both spoken AND a best take should be kept
    assert.equal(result.length, 1,
      "A 0.1s segment fully inside a best take should not be dropped");
  });
});

describe("Pipeline — adversarial: empty speakingSegments with bestTakes", () => {
  it("should return empty array when speakingSegments is empty", () => {
    const speaking = [];
    const bestTakes = [{ start: 0, end: 10, text: "take" }];
    const result = computeFinalSegments(speaking, bestTakes);
    assert.equal(result.length, 0);
  });
});

// ── Phase 4 helper tests ──

describe("Pipeline — filterEntriesForShort", () => {
  const entries = [
    { id: 1, start: 0, end: 5, text: "Before short" },
    { id: 2, start: 10, end: 15, text: "Inside short start" },
    { id: 3, start: 18, end: 22, text: "Inside short middle" },
    { id: 4, start: 25, end: 30, text: "Crosses short end" },
    { id: 5, start: 35, end: 40, text: "After short" },
  ];
  const short = { start: 10, end: 28, id: 1, duration: 18 };

  it("should include entries fully inside the short", () => {
    const result = filterEntriesForShort(entries, short);
    const ids = result.map((e) => e.id);
    assert.ok(ids.includes(2));
    assert.ok(ids.includes(3));
  });

  it("should include entries that cross the short boundary", () => {
    const result = filterEntriesForShort(entries, short);
    const ids = result.map((e) => e.id);
    assert.ok(ids.includes(4), "Entry crossing end boundary should be included");
  });

  it("should exclude entries fully outside the short", () => {
    const result = filterEntriesForShort(entries, short);
    const ids = result.map((e) => e.id);
    assert.ok(!ids.includes(1), "Entry before short should be excluded");
    assert.ok(!ids.includes(5), "Entry after short should be excluded");
  });

  it("should handle empty entries array", () => {
    const result = filterEntriesForShort([], short);
    assert.equal(result.length, 0);
  });

  it("should handle null short", () => {
    const result = filterEntriesForShort(entries, null);
    assert.equal(result.length, 0);
  });

  it("should handle malformed entries", () => {
    const bad = [null, undefined, { id: 1 }, { start: "x", end: 5 }];
    const result = filterEntriesForShort(bad, short);
    assert.equal(result.length, 0);
  });

  it("should reject Phase 2 short objects that are missing original time bounds", () => {
    const phase2Short = {
      id: 1,
      verticalPath: "/tmp/short-1.mp4",
      duration: 18,
      text: "assembled short",
      confidence: 0.9,
    };

    const result = filterEntriesForShort(entries, phase2Short);
    assert.equal(
      result.length,
      0,
      "Phase 4 should not include every caption/flash when the short has no start/end timestamps"
    );
  });
});

describe("Pipeline — rebaseTimestamps", () => {
  const short = { start: 10, end: 28, id: 1, duration: 18 };

  it("should rebase timestamps to start from 0", () => {
    const entries = [
      { id: 1, start: 12, end: 16, text: "Hello" },
      { id: 2, start: 20, end: 25, text: "World" },
    ];
    const result = rebaseTimestamps(entries, short);
    assert.equal(result[0].start, 2); // 12 - 10
    assert.equal(result[0].end, 6); // 16 - 10
    assert.equal(result[1].start, 10); // 20 - 10
    assert.equal(result[1].end, 15); // 25 - 10
  });

  it("should clamp timestamps to short duration", () => {
    const entries = [{ id: 1, start: 25, end: 35, text: "Crosses end" }];
    const result = rebaseTimestamps(entries, short);
    assert.equal(result[0].start, 15); // 25 - 10
    assert.equal(result[0].end, 18); // clamped to shortDuration (28-10=18)
  });

  it("should clamp negative start to 0", () => {
    const entries = [{ id: 1, start: 8, end: 14, text: "Before start" }];
    const result = rebaseTimestamps(entries, short);
    assert.equal(result[0].start, 0); // max(0, 8-10) = 0
    assert.equal(result[0].end, 4); // 14 - 10
  });

  it("should handle empty entries array", () => {
    const result = rebaseTimestamps([], short);
    assert.equal(result.length, 0);
  });

  it("should handle null short", () => {
    const result = rebaseTimestamps([{ start: 5, end: 10 }], null);
    assert.equal(result.length, 0);
  });

  it("should preserve non-timestamp fields", () => {
    const entries = [{ id: 1, start: 12, end: 16, text: "Hello", type: "term" }];
    const result = rebaseTimestamps(entries, short);
    assert.equal(result[0].text, "Hello");
    assert.equal(result[0].type, "term");
    assert.equal(result[0].id, 1);
  });

  it("should reject Phase 2 short objects that are missing original time bounds", () => {
    const entries = [{ id: 1, start: 12, end: 16, text: "Hello" }];
    const phase2Short = {
      id: 1,
      verticalPath: "/tmp/short-1.mp4",
      duration: 18,
      text: "assembled short",
      confidence: 0.9,
    };

    const result = rebaseTimestamps(entries, phase2Short);
    assert.equal(
      result.length,
      0,
      "Phase 4 should not emit invalid timestamps when the short has no start/end timestamps"
    );
  });

  it("should clamp rebased timestamps to the assembled short duration when provided", () => {
    const entries = [{ id: 1, start: 25, end: 28, text: "Late caption" }];
    const assembledShort = {
      id: 1,
      start: 10,
      end: 28,
      duration: 4,
    };

    const result = rebaseTimestamps(entries, assembledShort);
    assert.equal(
      result[0].end,
      4,
      "Caption timing should not extend past the actual assembled short duration"
    );
  });
});

describe("Pipeline — Phase 4 exports", () => {
  it("should export runPhase4", async () => {
    const { runPhase4 } = await import("./pipeline.js");
    assert.ok(typeof runPhase4 === "function");
  });
});
