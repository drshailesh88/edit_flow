/**
 * Confidence Tagger Module — Phase 5
 *
 * Tags every output (long-form + each short) as Green, Yellow, or Red.
 *
 * GREEN: Adversarial loop converged in ≤3 rounds, no flags.
 * YELLOW: Loop converged in 4-5 rounds, OR specific flags:
 *   - No B-roll match found
 *   - Ambiguous take selection
 *   - SSD disconnected
 *   - Low B-roll confidence (>50% yellow)
 * RED: Render failed, transcript unusable, Whisper confidence below threshold.
 */

/**
 * Valid confidence tags.
 */
export const CONFIDENCE_TAGS = ["green", "yellow", "red"];

/**
 * Tag a single output based on adversarial loop result and pipeline flags.
 *
 * @param {Object} params
 * @param {Object} params.loopResult - Result from runAdversarialLoop
 * @param {Object} params.manifest - Final manifest
 * @param {Object} params.pipelineFlags - Optional flags from pipeline stages
 * @returns {Object} { tag, reasons, details }
 */
export function tagConfidence({ loopResult, manifest, pipelineFlags = {} } = {}) {
  const reasons = [];

  // ─── RED checks (critical failures) ───────────────

  // No loop result at all
  if (!loopResult) {
    reasons.push("No adversarial loop result — pipeline may have failed");
    return { tag: "red", reasons, details: { roundsUsed: 0, converged: false } };
  }

  // Render failure
  if (pipelineFlags.renderFailed === true) {
    reasons.push("Render failed");
    return { tag: "red", reasons, details: buildDetails(loopResult) };
  }

  // Transcript unusable
  if (pipelineFlags.transcriptUnusable === true) {
    reasons.push("Transcript unusable");
    return { tag: "red", reasons, details: buildDetails(loopResult) };
  }

  // Whisper confidence below threshold or out of valid range
  if (typeof pipelineFlags.whisperConfidence === "number" &&
      Number.isFinite(pipelineFlags.whisperConfidence)) {
    if (pipelineFlags.whisperConfidence < 0 || pipelineFlags.whisperConfidence > 1) {
      reasons.push(`Whisper confidence out of valid range: ${pipelineFlags.whisperConfidence}`);
      return { tag: "red", reasons, details: buildDetails(loopResult) };
    }
    if (pipelineFlags.whisperConfidence < 0.5) {
      reasons.push(`Whisper confidence below threshold: ${(pipelineFlags.whisperConfidence * 100).toFixed(0)}%`);
      return { tag: "red", reasons, details: buildDetails(loopResult) };
    }
  }

  // Loop did not converge
  if (!loopResult.converged) {
    reasons.push(`Adversarial loop did not converge in ${loopResult.totalRounds} rounds`);
    return { tag: "red", reasons, details: buildDetails(loopResult) };
  }

  // ─── YELLOW checks (warnings) ─────────────────────

  // Converged but took 4+ rounds
  if (loopResult.totalRounds >= 4) {
    reasons.push(`Loop converged in ${loopResult.totalRounds} rounds (>3 — extended iteration)`);
  }

  // No B-roll match flags
  if (pipelineFlags.noBrollMatch === true) {
    reasons.push("No suitable B-roll match found for some segments");
  }

  // Ambiguous take selection
  if (pipelineFlags.ambiguousTake === true) {
    reasons.push("Ambiguous take selection — multiple similar quality takes");
  }

  // SSD disconnected
  if (pipelineFlags.ssdDisconnected === true) {
    reasons.push("B-roll SSD was disconnected during processing");
  }

  // Check manifest for yellow B-roll confidence (from flags or timeline, deduplicated)
  let hasBrollConfidenceIssue = false;
  if (manifest && Array.isArray(manifest.flags)) {
    const brollConfFlag = manifest.flags.find(f => f.category === "broll-confidence");
    if (brollConfFlag) hasBrollConfidenceIssue = true;
  }
  if (!hasBrollConfidenceIssue && manifest && Array.isArray(manifest.timeline)) {
    const broll = manifest.timeline.filter(e => e.type === "broll");
    const yellowBroll = broll.filter(e => e.confidence === "yellow");
    if (broll.length > 0 && yellowBroll.length > broll.length * 0.5) {
      hasBrollConfidenceIssue = true;
    }
  }
  if (hasBrollConfidenceIssue) {
    reasons.push("B-roll placements with low match confidence");
  }

  // Check for remaining unresolved issues in the last round
  if (Array.isArray(loopResult.history) && loopResult.history.length > 0) {
    const lastRound = loopResult.history[loopResult.history.length - 1];
    if (lastRound.critique && lastRound.critique.issueCount > 0 && lastRound.critique.passed) {
      // Passed but with minor issues — note them
      if (lastRound.critique.severity === "minor") {
        reasons.push(`Minor issues noted in final round: ${lastRound.critique.issueCount}`);
      }
    }
  }

  // ─── GREEN or YELLOW ──────────────────────────────

  if (reasons.length > 0) {
    return { tag: "yellow", reasons, details: buildDetails(loopResult) };
  }

  return {
    tag: "green",
    reasons: ["Adversarial loop converged within 3 rounds, no flags"],
    details: buildDetails(loopResult),
  };
}

/**
 * Build details object from loop result.
 *
 * @param {Object} loopResult
 * @returns {Object}
 */
function buildDetails(loopResult) {
  if (!loopResult) return { roundsUsed: 0, converged: false };

  return {
    roundsUsed: loopResult.totalRounds || 0,
    converged: loopResult.converged || false,
    maxRounds: loopResult.config?.maxRounds || 0,
    defaultRounds: loopResult.config?.defaultRounds || 0,
  };
}

/**
 * Tag multiple outputs (long-form + shorts) from a batch processing run.
 *
 * @param {Array} outputs - [{id, loopResult, manifest, pipelineFlags}]
 * @returns {Object} { tags: [{id, ...tagResult}], summary }
 */
export function tagBatch(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return { tags: [], summary: { green: 0, yellow: 0, red: 0, total: 0 } };
  }

  const tags = outputs.map((output, index) => ({
    id: output.id || `unknown-${index + 1}`,
    ...tagConfidence(output),
  }));

  const summary = {
    green: tags.filter(t => t.tag === "green").length,
    yellow: tags.filter(t => t.tag === "yellow").length,
    red: tags.filter(t => t.tag === "red").length,
    total: tags.length,
  };

  return { tags, summary };
}

/**
 * Format a confidence tag for display.
 *
 * @param {Object} tagResult - Result from tagConfidence
 * @returns {string} Formatted string
 */
export function formatTag(tagResult) {
  if (!tagResult || !tagResult.tag) return "[?] No confidence data";

  const icon = tagResult.tag === "green" ? "[GREEN]"
    : tagResult.tag === "yellow" ? "[YELLOW]"
    : "[RED]";

  const roundInfo = tagResult.details
    ? ` (${tagResult.details.roundsUsed} round${tagResult.details.roundsUsed !== 1 ? "s" : ""})`
    : "";

  const reasonList = Array.isArray(tagResult.reasons) && tagResult.reasons.length > 0
    ? "\n  " + tagResult.reasons.join("\n  ")
    : "";

  return `${icon}${roundInfo}${reasonList}`;
}
