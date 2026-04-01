/**
 * Tests for Confidence Tagger Module — Phase 5, Requirement 5
 *
 * Tests Green/Yellow/Red tagging based on adversarial loop results,
 * pipeline flags, and manifest quality.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tagConfidence,
  tagBatch,
  formatTag,
  CONFIDENCE_TAGS,
} from "./confidence-tagger.js";

// ─────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────

function makeLoopResult(overrides = {}) {
  return {
    converged: true,
    totalRounds: 2,
    config: { defaultRounds: 3, maxRounds: 5 },
    history: [
      {
        round: 1,
        critique: { passed: false, severity: "minor", issueCount: 1, summary: "Minor issue" },
        resolution: { action: "resolved", changes: 1, aiChanges: 0, issuesResolved: 1, issuesRemaining: 0 },
      },
      {
        round: 2,
        critique: { passed: true, severity: "pass", issueCount: 0, summary: "All clear" },
        resolution: { action: "converged", changes: 0, aiChanges: 0, issuesResolved: 0, issuesRemaining: 0 },
      },
    ],
    ...overrides,
  };
}

function makeManifest(overrides = {}) {
  return {
    version: 1,
    timeline: [
      { id: 1, type: "aroll", start: 0, end: 30, duration: 30 },
      { id: 2, type: "broll", start: 15, end: 20, duration: 5, confidence: "green" },
    ],
    flags: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────
// CONFIDENCE_TAGS
// ─────────────────────────────────────────────────────

describe("CONFIDENCE_TAGS", () => {
  it("contains green, yellow, red", () => {
    assert.deepStrictEqual(CONFIDENCE_TAGS, ["green", "yellow", "red"]);
  });
});

// ─────────────────────────────────────────────────────
// tagConfidence — GREEN
// ─────────────────────────────────────────────────────

describe("tagConfidence — GREEN", () => {
  it("returns green for clean convergence in ≤3 rounds", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 1, converged: true }),
      manifest: makeManifest(),
    });
    assert.equal(result.tag, "green");
    assert.ok(result.reasons.length > 0);
  });

  it("returns green for convergence in exactly 3 rounds", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 3, converged: true }),
      manifest: makeManifest(),
    });
    assert.equal(result.tag, "green");
  });

  it("includes round details", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 2 }),
      manifest: makeManifest(),
    });
    assert.equal(result.details.roundsUsed, 2);
    assert.equal(result.details.converged, true);
  });
});

// ─────────────────────────────────────────────────────
// tagConfidence — YELLOW
// ─────────────────────────────────────────────────────

describe("tagConfidence — YELLOW", () => {
  it("returns yellow for convergence in 4 rounds", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 4, converged: true }),
      manifest: makeManifest(),
    });
    assert.equal(result.tag, "yellow");
    assert.ok(result.reasons.some(r => r.includes("4 rounds")));
  });

  it("returns yellow for convergence in 5 rounds", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 5, converged: true }),
      manifest: makeManifest(),
    });
    assert.equal(result.tag, "yellow");
  });

  it("returns yellow when no B-roll match", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { noBrollMatch: true },
    });
    assert.equal(result.tag, "yellow");
    assert.ok(result.reasons.some(r => r.includes("B-roll match")));
  });

  it("returns yellow for ambiguous take", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { ambiguousTake: true },
    });
    assert.equal(result.tag, "yellow");
  });

  it("returns yellow for SSD disconnected", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { ssdDisconnected: true },
    });
    assert.equal(result.tag, "yellow");
    assert.ok(result.reasons.some(r => r.includes("SSD")));
  });

  it("returns yellow for low B-roll confidence in manifest", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest({
        timeline: [
          { id: 1, type: "aroll", start: 0, end: 30, duration: 30 },
          { id: 2, type: "broll", start: 10, end: 15, duration: 5, confidence: "yellow" },
          { id: 3, type: "broll", start: 20, end: 25, duration: 5, confidence: "yellow" },
        ],
      }),
    });
    assert.equal(result.tag, "yellow");
    assert.ok(result.reasons.some(r => r.includes("confidence")));
  });

  it("accumulates multiple yellow reasons", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 4, converged: true }),
      manifest: makeManifest(),
      pipelineFlags: { noBrollMatch: true, ambiguousTake: true },
    });
    assert.equal(result.tag, "yellow");
    assert.ok(result.reasons.length >= 3);
  });
});

// ─────────────────────────────────────────────────────
// tagConfidence — RED
// ─────────────────────────────────────────────────────

describe("tagConfidence — RED", () => {
  it("returns red for null loop result", () => {
    const result = tagConfidence({ loopResult: null, manifest: null });
    assert.equal(result.tag, "red");
  });

  it("returns red for undefined params", () => {
    const result = tagConfidence();
    assert.equal(result.tag, "red");
  });

  it("returns red for render failure", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { renderFailed: true },
    });
    assert.equal(result.tag, "red");
    assert.ok(result.reasons.some(r => r.includes("Render failed")));
  });

  it("returns red for unusable transcript", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { transcriptUnusable: true },
    });
    assert.equal(result.tag, "red");
  });

  it("returns red for low Whisper confidence", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { whisperConfidence: 0.3 },
    });
    assert.equal(result.tag, "red");
    assert.ok(result.reasons.some(r => r.includes("30%")));
  });

  it("returns red for non-converged loop", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult({ converged: false, totalRounds: 5 }),
      manifest: makeManifest(),
    });
    assert.equal(result.tag, "red");
    assert.ok(result.reasons.some(r => r.includes("did not converge")));
  });

  it("treats Whisper confidence exactly at 0.5 as OK (not red)", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { whisperConfidence: 0.5 },
    });
    assert.notEqual(result.tag, "red");
  });

  it("handles NaN Whisper confidence gracefully", () => {
    const result = tagConfidence({
      loopResult: makeLoopResult(),
      manifest: makeManifest(),
      pipelineFlags: { whisperConfidence: NaN },
    });
    // NaN should not trigger red — it's not a valid confidence value
    assert.notEqual(result.tag, "red");
  });
});

// ─────────────────────────────────────────────────────
// tagBatch
// ─────────────────────────────────────────────────────

describe("tagBatch", () => {
  it("returns empty result for empty array", () => {
    const result = tagBatch([]);
    assert.equal(result.tags.length, 0);
    assert.equal(result.summary.total, 0);
  });

  it("returns empty result for null", () => {
    const result = tagBatch(null);
    assert.equal(result.tags.length, 0);
  });

  it("tags multiple outputs and provides summary", () => {
    const outputs = [
      { id: "longform", loopResult: makeLoopResult(), manifest: makeManifest() },
      { id: "short-1", loopResult: makeLoopResult({ totalRounds: 4, converged: true }), manifest: makeManifest() },
      { id: "short-2", loopResult: null, manifest: null },
    ];

    const result = tagBatch(outputs);
    assert.equal(result.tags.length, 3);
    assert.equal(result.summary.green, 1);
    assert.equal(result.summary.yellow, 1);
    assert.equal(result.summary.red, 1);
    assert.equal(result.summary.total, 3);
  });

  it("preserves output IDs", () => {
    const outputs = [
      { id: "short-3", loopResult: makeLoopResult(), manifest: makeManifest() },
    ];
    const result = tagBatch(outputs);
    assert.equal(result.tags[0].id, "short-3");
  });
});

// ─────────────────────────────────────────────────────
// formatTag
// ─────────────────────────────────────────────────────

describe("formatTag", () => {
  it("formats green tag", () => {
    const tag = tagConfidence({ loopResult: makeLoopResult({ totalRounds: 1 }), manifest: makeManifest() });
    const formatted = formatTag(tag);
    assert.ok(formatted.includes("[GREEN]"));
    assert.ok(formatted.includes("1 round"));
  });

  it("formats yellow tag with reasons", () => {
    const tag = tagConfidence({
      loopResult: makeLoopResult({ totalRounds: 4, converged: true }),
      manifest: makeManifest(),
    });
    const formatted = formatTag(tag);
    assert.ok(formatted.includes("[YELLOW]"));
    assert.ok(formatted.includes("4 rounds"));
  });

  it("formats red tag", () => {
    const tag = tagConfidence({ loopResult: null });
    const formatted = formatTag(tag);
    assert.ok(formatted.includes("[RED]"));
  });

  it("handles null input", () => {
    const formatted = formatTag(null);
    assert.ok(formatted.includes("?"));
  });
});
