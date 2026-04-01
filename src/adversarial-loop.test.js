/**
 * Tests for Adversarial Loop Module — Phase 5, Requirement 4
 *
 * Tests loop orchestration, convergence detection, round limits,
 * and configuration validation. Uses skipAI to avoid Claude API calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig,
  runAdversarialLoop,
  runLoopForShort,
  assessConvergence,
  DEFAULT_CONFIG,
} from "./adversarial-loop.js";

// ─────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────

// A "good" manifest that passes deterministic critic checks
function makeGoodParams() {
  return {
    recordingName: "test-good",
    type: "short",
    segments: [
      { start: 0, end: 30, duration: 30 },
    ],
    brollPlacements: [
      { insertAt: 10, duration: 5, clipPath: "/lib/medical/surgery.mp4", confidence: "green" },
    ],
    captions: [
      { id: 1, start: 0, end: 10, text: "Today we discuss surgery." },
      { id: 2, start: 10, end: 20, text: "The procedure is straightforward." },
    ],
    termFlashes: [
      { id: 1, start: 5, end: 8, text: "Surgery", type: "term" },
    ],
    transcript: {
      language: "en",
      segments: [
        { start: 0, end: 30, text: "Today we discuss surgery and the procedure is straightforward." },
      ],
    },
  };
}

// A "bad" manifest that fails deterministic critic checks (no A-roll)
function makeBadParams() {
  return {
    recordingName: "test-bad",
    type: "longform",
    segments: [], // Empty — will trigger critical "no A-roll" issue
    brollPlacements: [],
    captions: [],
    termFlashes: [],
    transcript: {
      language: "en",
      segments: [
        { start: 0, end: 30, text: "Some content." },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────────────

describe("validateConfig", () => {
  it("returns defaults for empty config", () => {
    const config = validateConfig();
    assert.equal(config.defaultRounds, DEFAULT_CONFIG.defaultRounds);
    assert.equal(config.maxRounds, DEFAULT_CONFIG.maxRounds);
    assert.equal(config.model, DEFAULT_CONFIG.model);
    assert.equal(config.skipAI, false);
  });

  it("clamps maxRounds to 1-10 range", () => {
    assert.equal(validateConfig({ maxRounds: 0 }).maxRounds, 1);
    assert.equal(validateConfig({ maxRounds: -5 }).maxRounds, 1);
    assert.equal(validateConfig({ maxRounds: 100 }).maxRounds, 10);
    assert.equal(validateConfig({ maxRounds: 7 }).maxRounds, 7);
  });

  it("clamps defaultRounds to not exceed maxRounds", () => {
    const config = validateConfig({ defaultRounds: 10, maxRounds: 3 });
    assert.equal(config.defaultRounds, 3);
    assert.equal(config.maxRounds, 3);
  });

  it("rejects NaN/Infinity for rounds", () => {
    assert.equal(validateConfig({ maxRounds: NaN }).maxRounds, DEFAULT_CONFIG.maxRounds);
    assert.equal(validateConfig({ maxRounds: Infinity }).maxRounds, DEFAULT_CONFIG.maxRounds);
    assert.equal(validateConfig({ defaultRounds: NaN }).defaultRounds, DEFAULT_CONFIG.defaultRounds);
  });

  it("rounds fractional values", () => {
    assert.equal(validateConfig({ maxRounds: 3.7 }).maxRounds, 4);
    assert.equal(validateConfig({ defaultRounds: 2.3 }).defaultRounds, 2);
  });

  it("rejects empty model string", () => {
    assert.equal(validateConfig({ model: "" }).model, DEFAULT_CONFIG.model);
  });

  it("passes valid editorial voice through", () => {
    const config = validateConfig({ editorialVoice: "Custom voice" });
    assert.equal(config.editorialVoice, "Custom voice");
  });
});

// ─────────────────────────────────────────────────────
// runAdversarialLoop
// ─────────────────────────────────────────────────────

describe("runAdversarialLoop", () => {
  it("converges in 1 round for a good manifest (skipAI)", async () => {
    const params = makeGoodParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 5 });

    assert.ok(result.converged, "Good manifest should converge");
    assert.equal(result.totalRounds, 1);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].critique.passed, true);
    assert.ok(result.manifest);
  });

  it("does not converge for a structurally broken manifest", async () => {
    const params = makeBadParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 3 });

    assert.equal(result.converged, false);
    assert.equal(result.totalRounds, 3);
    assert.equal(result.history.length, 3);
  });

  it("respects maxRounds limit", async () => {
    const params = makeBadParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 2 });

    assert.equal(result.totalRounds, 2);
    assert.equal(result.history.length, 2);
  });

  it("records round history with critique and resolution", async () => {
    const params = makeBadParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 2 });

    for (const entry of result.history) {
      assert.ok(entry.round > 0);
      assert.ok(entry.critique);
      assert.ok(typeof entry.critique.passed === "boolean");
      assert.ok(typeof entry.critique.issueCount === "number");
      assert.ok(entry.resolution);
    }
  });

  it("includes config in result", async () => {
    const params = makeGoodParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 4, defaultRounds: 2 });

    assert.equal(result.config.maxRounds, 4);
    assert.equal(result.config.defaultRounds, 2);
  });

  it("returns valid manifest even when not converged", async () => {
    const params = makeBadParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 1 });

    assert.ok(result.manifest);
    assert.equal(result.manifest.version, 1);
    assert.equal(result.converged, false);
  });

  it("handles single round (maxRounds=1) correctly", async () => {
    const params = makeGoodParams();
    const result = await runAdversarialLoop(params, { skipAI: true, maxRounds: 1 });

    assert.equal(result.totalRounds, 1);
    assert.ok(result.converged);
  });
});

// ─────────────────────────────────────────────────────
// runLoopForShort
// ─────────────────────────────────────────────────────

describe("runLoopForShort", () => {
  it("runs loop with short type", async () => {
    const shortData = {
      id: 1,
      recordingName: "cardiac-lecture",
      segments: [{ start: 0, end: 20 }],
      captions: [{ id: 1, start: 0, end: 10, text: "Short caption." }],
      termFlashes: [],
      brollPlacements: [],
    };
    const transcript = { language: "en", segments: [{ start: 0, end: 20, text: "Test." }] };

    const result = await runLoopForShort(shortData, transcript, { skipAI: true, maxRounds: 2 });

    assert.ok(result.manifest);
    assert.equal(result.manifest.type, "short");
  });

  it("defaults recordingName from short id", async () => {
    const shortData = { id: 5, segments: [{ start: 0, end: 10 }] };
    const transcript = { language: "en", segments: [] };

    const result = await runLoopForShort(shortData, transcript, { skipAI: true, maxRounds: 1 });

    assert.equal(result.manifest.recordingName, "short-5");
  });
});

// ─────────────────────────────────────────────────────
// assessConvergence
// ─────────────────────────────────────────────────────

describe("assessConvergence", () => {
  it("returns 'failed' for null input", () => {
    assert.equal(assessConvergence(null).quality, "failed");
  });

  it("returns 'failed' when not converged", () => {
    const result = assessConvergence({ converged: false, totalRounds: 5, config: { maxRounds: 5 } });
    assert.equal(result.quality, "failed");
    assert.ok(result.description.includes("5 rounds"));
  });

  it("returns 'fast' for 1-round convergence", () => {
    assert.equal(assessConvergence({ converged: true, totalRounds: 1 }).quality, "fast");
  });

  it("returns 'normal' for 2-3 round convergence", () => {
    assert.equal(assessConvergence({ converged: true, totalRounds: 2 }).quality, "normal");
    assert.equal(assessConvergence({ converged: true, totalRounds: 3 }).quality, "normal");
  });

  it("returns 'slow' for 4+ round convergence", () => {
    assert.equal(assessConvergence({ converged: true, totalRounds: 4 }).quality, "slow");
    assert.equal(assessConvergence({ converged: true, totalRounds: 5 }).quality, "slow");
  });
});
