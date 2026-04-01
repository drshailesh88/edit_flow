/**
 * Adversarial Loop Module — Phase 5
 *
 * Orchestrates the Editor → Critic → Resolver cycle.
 * Runs 3 rounds by default, up to 5 max.
 *
 * Flow per round:
 * 1. Editor generates/revises Manifest (round 1 only — assembles from pipeline data)
 * 2. Critic evaluates Manifest JSON + Transcript (no rendered preview)
 * 3. If Critic passes → converged, exit loop
 * 4. Resolver applies fixes → revised Manifest
 * 5. Back to step 2 with revised Manifest
 *
 * Final render happens ONCE after the loop converges.
 */

import { assembleManifest, enhanceManifest } from "./editor-agent.js";
import { critiqueManifest } from "./critic-agent.js";
import { resolveManifest } from "./resolver-agent.js";

/**
 * Default loop configuration.
 */
export const DEFAULT_CONFIG = {
  defaultRounds: 3,
  maxRounds: 5,
  model: "claude-sonnet-4-20250514",
  skipAI: false,
};

/**
 * Validate loop configuration, clamping values to safe ranges.
 *
 * @param {Object} config - User-provided config
 * @returns {Object} Validated config
 */
export function validateConfig(config = {}) {
  const maxRounds = typeof config.maxRounds === "number" && Number.isFinite(config.maxRounds)
    ? Math.max(1, Math.min(10, Math.round(config.maxRounds)))
    : DEFAULT_CONFIG.maxRounds;

  const defaultRounds = typeof config.defaultRounds === "number" && Number.isFinite(config.defaultRounds)
    ? Math.max(1, Math.min(maxRounds, Math.round(config.defaultRounds)))
    : Math.min(DEFAULT_CONFIG.defaultRounds, maxRounds);

  return {
    defaultRounds,
    maxRounds,
    model: typeof config.model === "string" && config.model.length > 0
      ? config.model
      : DEFAULT_CONFIG.model,
    skipAI: config.skipAI === true,
    editorialVoice: typeof config.editorialVoice === "string" ? config.editorialVoice : undefined,
  };
}

/**
 * Run the adversarial quality loop.
 *
 * @param {Object} params - Pipeline data for manifest assembly
 * @param {Object} params.recordingName - Recording identifier
 * @param {Object} params.type - "longform" or "short"
 * @param {Array} params.segments - A-roll segments
 * @param {Array} params.brollPlacements - B-roll placements
 * @param {Array} params.captions - Caption entries
 * @param {Array} params.termFlashes - Term flash entries
 * @param {Object} params.transcript - Original transcript
 * @param {Object} options - Loop configuration (see DEFAULT_CONFIG)
 * @returns {Promise<Object>} Loop result with final manifest, round history, convergence info
 */
export async function runAdversarialLoop(params, options = {}) {
  const config = validateConfig(options);
  const history = [];

  // Round 1: Editor assembles initial manifest
  let manifest = assembleManifest(params);

  // Optionally enhance with AI (round 1 only)
  if (!config.skipAI && params.transcript) {
    manifest = await enhanceManifest(manifest, params.transcript, { model: config.model });
  }

  // Loop: Critic → (pass? done : Resolver → next round)
  let converged = false;
  let finalRound = 0;

  // Use defaultRounds as the target, maxRounds as hard cap
  const roundLimit = config.defaultRounds;

  for (let round = 1; round <= roundLimit; round++) {
    finalRound = round;

    // Critic evaluates
    const critique = await critiqueManifest(manifest, params.transcript, {
      model: config.model,
      round,
      editorialVoice: config.editorialVoice,
      skipAI: config.skipAI,
    });

    const roundEntry = {
      round,
      critique: {
        passed: critique.passed,
        severity: critique.severity,
        issueCount: critique.issues.length,
        summary: critique.summary,
      },
      resolution: null,
    };

    // Check convergence
    if (critique.passed) {
      converged = true;
      roundEntry.resolution = { action: "converged", changes: 0, aiChanges: 0, issuesResolved: 0, issuesRemaining: 0 };
      history.push(roundEntry);
      break;
    }

    // If we've hit the round limit and still not converged, stop
    if (round >= roundLimit) {
      roundEntry.resolution = { action: "max_rounds_reached", changes: 0, aiChanges: 0, issuesResolved: 0, issuesRemaining: critique.issues.length };
      history.push(roundEntry);
      break;
    }

    // Resolver applies fixes
    const resolution = await resolveManifest(manifest, critique, {
      model: config.model,
      skipAI: config.skipAI,
    });

    manifest = resolution.manifest;

    roundEntry.resolution = {
      action: "resolved",
      changes: resolution.changes.length,
      aiChanges: resolution.aiChanges.length,
      issuesResolved: resolution.resolutions.resolved,
      issuesRemaining: resolution.resolutions.remaining,
    };

    history.push(roundEntry);
  }

  return {
    manifest,
    converged,
    totalRounds: finalRound,
    history,
    config: {
      defaultRounds: config.defaultRounds,
      maxRounds: config.maxRounds,
    },
  };
}

/**
 * Run the adversarial loop for a single short.
 * Convenience wrapper that sets type="short" and handles short-specific data.
 *
 * @param {Object} shortData - Short metadata (id, segments, captions, termFlashes, etc.)
 * @param {Object} transcript - Original transcript
 * @param {Object} options - Loop configuration
 * @returns {Promise<Object>} Loop result
 */
export async function runLoopForShort(shortData, transcript, options = {}) {
  return runAdversarialLoop({
    recordingName: shortData.recordingName || `short-${shortData.id}`,
    type: "short",
    segments: shortData.segments || [],
    brollPlacements: shortData.brollPlacements || [],
    captions: shortData.captions || [],
    termFlashes: shortData.termFlashes || [],
    transcript,
  }, options);
}

/**
 * Determine convergence quality from loop result.
 *
 * @param {Object} loopResult - Result from runAdversarialLoop
 * @returns {Object} { quality: "fast"|"normal"|"slow"|"failed", description }
 */
export function assessConvergence(loopResult) {
  if (!loopResult) {
    return { quality: "failed", description: "No loop result" };
  }

  if (!loopResult.converged) {
    return {
      quality: "failed",
      description: `Did not converge in ${loopResult.totalRounds} rounds (max: ${loopResult.config?.maxRounds || "unknown"})`,
    };
  }

  if (loopResult.totalRounds <= 0) {
    return { quality: "failed", description: "No rounds executed" };
  }

  if (loopResult.totalRounds === 1) {
    return { quality: "fast", description: "Converged in 1 round — manifest passed initial review" };
  }

  if (loopResult.totalRounds <= 3) {
    return { quality: "normal", description: `Converged in ${loopResult.totalRounds} rounds — normal quality iteration` };
  }

  return {
    quality: "slow",
    description: `Converged in ${loopResult.totalRounds} rounds — required extended iteration`,
  };
}
