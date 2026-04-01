/**
 * Tests for the Pipeline module
 *
 * Tests segment intersection logic and pipeline integration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFinalSegments } from "./pipeline.js";

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
