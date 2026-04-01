/**
 * B-roll Placer Module — Phase 3
 *
 * Takes B-roll match results and produces a placement manifest
 * that maps B-roll clips to specific timestamps in the output video.
 *
 * Supports two placement strategies:
 * - Aggressive (long-form): B-roll every 15-20 seconds
 * - Selective (shorts): B-roll only at topic-relevant moments
 *
 * When no suitable B-roll match exists, the placement is flagged
 * Yellow (no irrelevant footage is inserted).
 *
 * Output: A manifest JSON that can be used by FFmpeg to composite
 * B-roll over A-roll, or by later phases (Remotion overlay).
 */

import { matchBroll } from "./broll-matcher.js";
import { existsSync } from "node:fs";

/**
 * Generate B-roll placement manifest for a long-form video.
 *
 * Uses aggressive mode: attempts B-roll every 15-20 seconds.
 * Flags Yellow when no suitable match exists — does NOT insert
 * irrelevant footage.
 *
 * @param {Array} transcriptSegments - [{start, end, text}]
 * @param {string} brollDbPath - Path to the B-roll index database
 * @param {object} options
 * @param {number} options.brollDuration - Duration of each B-roll insert (default 5s)
 * @param {number} options.minScore - Minimum match score (default 0.15)
 * @returns {{manifest: Array, stats: object, warnings: string[]}}
 */
export function placeBrollLongform(transcriptSegments, brollDbPath, options = {}) {
  const { brollDuration = 5, minScore = 0.15 } = options;

  if (!transcriptSegments || transcriptSegments.length === 0) {
    return {
      manifest: [],
      stats: { totalPlacements: 0, greenPlacements: 0, yellowPlacements: 0, mode: "aggressive" },
      warnings: ["No transcript segments provided"],
    };
  }

  if (!brollDbPath || !existsSync(brollDbPath)) {
    return {
      manifest: [],
      stats: { totalPlacements: 0, greenPlacements: 0, yellowPlacements: 0, mode: "aggressive" },
      warnings: ["B-roll database not found — run indexer first"],
    };
  }

  const { placements, stats } = matchBroll(transcriptSegments, brollDbPath, {
    mode: "aggressive",
    minScore,
    brollDuration,
  });

  const warnings = [];

  // Build the manifest with placement details
  const manifest = placements.map((p, i) => {
    const entry = {
      id: i + 1,
      insertAt: p.timestamp,
      duration: p.duration,
      confidence: p.confidence,
      reason: p.reason,
      contextText: p.momentText,
    };

    if (p.clip) {
      entry.brollClip = {
        id: p.clip.id,
        filePath: p.clip.filePath,
        filename: p.clip.filename,
        description: p.clip.description,
      };
    } else {
      entry.brollClip = null;
      warnings.push(`Yellow @ ${p.timestamp.toFixed(1)}s: ${p.reason} — "${p.momentText}"`);
    }

    return entry;
  });

  return { manifest, stats, warnings };
}

/**
 * Generate B-roll placement manifest for a Short video.
 *
 * Uses selective mode: B-roll only at highly topic-relevant moments.
 * Much less aggressive than long-form — quality over quantity.
 * Flags Yellow when no suitable match exists.
 *
 * @param {Array} transcriptSegments - [{start, end, text}] for this short
 * @param {string} brollDbPath - Path to the B-roll index database
 * @param {object} options
 * @param {number} options.brollDuration - Duration of each B-roll insert (default 4s)
 * @param {number} options.minScore - Minimum match score (default 0.25, higher than long-form)
 * @returns {{manifest: Array, stats: object, warnings: string[]}}
 */
export function placeBrollShort(transcriptSegments, brollDbPath, options = {}) {
  const { brollDuration = 4, minScore = 0.25 } = options;

  if (!transcriptSegments || transcriptSegments.length === 0) {
    return {
      manifest: [],
      stats: { totalPlacements: 0, greenPlacements: 0, yellowPlacements: 0, mode: "selective" },
      warnings: ["No transcript segments provided"],
    };
  }

  if (!brollDbPath || !existsSync(brollDbPath)) {
    return {
      manifest: [],
      stats: { totalPlacements: 0, greenPlacements: 0, yellowPlacements: 0, mode: "selective" },
      warnings: ["B-roll database not found — run indexer first"],
    };
  }

  const { placements, stats } = matchBroll(transcriptSegments, brollDbPath, {
    mode: "selective",
    minScore,
    brollDuration,
  });

  const warnings = [];

  // For shorts, only include placements with actual clips (skip yellow no-match)
  // But still track them in warnings for review
  const manifest = [];

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const entry = {
      id: i + 1,
      insertAt: p.timestamp,
      duration: p.duration,
      confidence: p.confidence,
      reason: p.reason,
      contextText: p.momentText,
    };

    if (p.clip) {
      entry.brollClip = {
        id: p.clip.id,
        filePath: p.clip.filePath,
        filename: p.clip.filename,
        description: p.clip.description,
      };
      manifest.push(entry);
    } else {
      // For shorts, Yellow means "skip" — don't insert, just warn
      entry.brollClip = null;
      warnings.push(`Yellow @ ${p.timestamp.toFixed(1)}s: ${p.reason} — "${p.momentText}"`);
    }
  }

  return { manifest, stats, warnings };
}

/**
 * Compute the overall confidence tag for a video based on B-roll placement.
 *
 * Green: All placements matched with good scores
 * Yellow: Some placements flagged (no match, weak match)
 * Red: Not used for B-roll (reserved for render failures)
 *
 * @param {{manifest: Array, stats: object, warnings: string[]}} placementResult
 * @returns {"green"|"yellow"}
 */
export function computeBrollConfidence(placementResult) {
  if (!placementResult || !placementResult.stats) return "yellow";

  const { yellowPlacements, totalPlacements } = placementResult.stats;

  if (totalPlacements === 0) return "yellow";
  if (yellowPlacements === 0) return "green";

  // If more than 30% of placements are yellow, flag the whole video
  const yellowRatio = yellowPlacements / totalPlacements;
  return yellowRatio > 0.3 ? "yellow" : "green";
}

/**
 * Format a B-roll manifest for human review (console output).
 *
 * @param {{manifest: Array, stats: object, warnings: string[]}} result
 * @returns {string} Formatted report
 */
export function formatBrollReport(result) {
  const lines = [];
  const { manifest, stats, warnings } = result;

  lines.push(`  Mode: ${stats.mode}`);
  lines.push(`  Total moments: ${stats.totalMoments}`);
  lines.push(`  Placements: ${manifest.length}`);
  lines.push(`  Green: ${stats.greenPlacements}`);
  lines.push(`  Yellow: ${stats.yellowPlacements}`);
  lines.push(`  Clips used: ${stats.uniqueClipsUsed}`);
  lines.push(`  Confidence: ${computeBrollConfidence(result).toUpperCase()}`);

  if (warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of warnings) {
      lines.push(`    - ${w}`);
    }
  }

  return lines.join("\n");
}
