/**
 * Pipeline Module — Phase 1 Tracer Bullet
 *
 * Connects Ingest → Take Selection → Assembler for end-to-end flow:
 * Raw Recording → silence-removed, best-take-selected, assembled MP4
 */

import { ingest } from "./ingest.js";
import { selectTakes } from "./take-selector.js";
import { assembleFromSegments, getVideoDuration } from "./assembler.js";
import { mkdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * Compute final speaking segments by intersecting silence-based segments
 * with best-take time ranges from the transcript.
 *
 * The speaking segments define when the speaker is NOT silent.
 * The best takes define which content to keep (discarding bad takes).
 *
 * A final segment exists only where both conditions are true:
 * the speaker is talking AND the content is a best take.
 *
 * @param {Array} speakingSegments - [{start, end}] from silence detection
 * @param {Array} bestTakes - [{start, end, ...}] from take selection
 * @returns {Array} [{start, end}] final segments for assembly
 */
export function computeFinalSegments(speakingSegments, bestTakes) {
  if (!speakingSegments) return [];
  if (!bestTakes || bestTakes.length === 0) return speakingSegments.map(s => ({ ...s }));

  const final = [];

  for (const speaking of speakingSegments) {
    for (const take of bestTakes) {
      // Find overlap between speaking segment and best take
      const overlapStart = Math.max(speaking.start, take.start);
      const overlapEnd = Math.min(speaking.end, take.end);

      if (overlapEnd - overlapStart >= 0.099) {
        final.push({ start: overlapStart, end: overlapEnd });
      }
    }
  }

  // Sort by start time and merge adjacent segments (within 0.1s gap)
  final.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const seg of final) {
    if (merged.length > 0 && seg.start - merged[merged.length - 1].end < 0.15) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

/**
 * Phase 1 pipeline: Recording → silence-removed, best-take-selected MP4
 *
 * Steps:
 * 1. Ingest (transcribe + detect silence + compute speaking segments)
 * 2. Take Selection (detect bad takes, group duplicates, select best)
 * 3. Assemble (cut silence + bad takes, concatenate best segments)
 */
export async function runPhase1(recordingPath, options = {}) {
  const {
    outputDir = "output",
    dataDir = "data",
    whisperModel = "medium",
    language = null,
  } = options;

  await mkdir(outputDir, { recursive: true });

  const recordingName = basename(recordingPath).replace(/\.[^.]+$/, "");
  const outputPath = join(outputDir, `${recordingName}-edited.mp4`);

  console.log("═══════════════════════════════════════");
  console.log(`PHASE 1: Tracer Bullet`);
  console.log(`Recording: ${basename(recordingPath)}`);
  console.log("═══════════════════════════════════════\n");

  // Step 1: Ingest
  console.log("STEP 1: Ingest (transcribe + silence detection)");
  console.log("─────────────────────────────────────");
  const ingestResult = await ingest(recordingPath, dataDir, {
    whisperModel,
    language,
  });

  const { mediaInfo, silences, speakingSegments, transcript } = ingestResult;

  const silenceTotal = silences.reduce((acc, s) => acc + s.duration, 0);
  const speakingTotal = speakingSegments.reduce((acc, s) => acc + (s.end - s.start), 0);

  console.log(`\n  Original duration: ${(mediaInfo.duration / 60).toFixed(1)} min`);
  console.log(`  Silence removed:  ${(silenceTotal / 60).toFixed(1)} min`);
  console.log(`  Speaking kept:    ${(speakingTotal / 60).toFixed(1)} min`);
  console.log(`  Transcript:       ${transcript.segments.length} segments, language: ${transcript.language}\n`);

  // Step 2: Take Selection
  console.log("STEP 2: Take Selection (detect bad takes, select best)");
  console.log("─────────────────────────────────────");
  const takeResult = selectTakes(transcript);

  console.log(`  Total segments:   ${takeResult.stats.totalSegments}`);
  console.log(`  Bad takes found:  ${takeResult.stats.badTakes}`);
  console.log(`  Duplicates:       ${takeResult.stats.discarded} discarded`);
  console.log(`  Best takes kept:  ${takeResult.stats.kept}`);

  // Compute final segments (intersection of silence-removed + best takes)
  const finalSegments = computeFinalSegments(speakingSegments, takeResult.bestTakes);
  const finalSegmentsDuration = finalSegments.reduce((acc, s) => acc + (s.end - s.start), 0);

  console.log(`  Final segments:   ${finalSegments.length} (${(finalSegmentsDuration / 60).toFixed(1)} min)\n`);

  // Save take selection results
  const takeSelectionPath = join(dataDir, `${recordingName}-take-selection.json`);
  await writeFile(takeSelectionPath, JSON.stringify({
    bestTakes: takeResult.bestTakes.map(t => ({ start: t.start, end: t.end, text: t.text })),
    discarded: takeResult.discarded.map(t => ({ start: t.start, end: t.end, text: t.text, reason: t.discardReason })),
    stats: takeResult.stats,
  }, null, 2));

  // Save final segments
  const finalSegmentsPath = join(dataDir, `${recordingName}-final-segments.json`);
  await writeFile(finalSegmentsPath, JSON.stringify(finalSegments, null, 2));

  // Step 3: Assemble
  console.log("STEP 3: Assemble (cut + concatenate)");
  console.log("─────────────────────────────────────");
  await assembleFromSegments(recordingPath, finalSegments, outputPath);

  const finalDuration = await getVideoDuration(outputPath);
  const savedTime = mediaInfo.duration - finalDuration;

  console.log(`\n  Output: ${outputPath}`);
  console.log(`  Final duration: ${(finalDuration / 60).toFixed(1)} min`);
  console.log(`  Time saved: ${(savedTime / 60).toFixed(1)} min (${((savedTime / mediaInfo.duration) * 100).toFixed(0)}% reduction)\n`);

  console.log("═══════════════════════════════════════");
  console.log("PHASE 1 COMPLETE");
  console.log("═══════════════════════════════════════");

  return {
    recordingPath,
    outputPath,
    originalDuration: mediaInfo.duration,
    finalDuration,
    silenceRemoved: silenceTotal,
    segmentCount: finalSegments.length,
    transcriptSegments: transcript.segments.length,
    language: transcript.language,
    takeSelection: takeResult.stats,
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("pipeline.js") && process.argv[2]) {
  const recordingPath = process.argv[2];
  const model = process.argv[3] || "medium";
  const language = process.argv[4] || null;

  runPhase1(recordingPath, { whisperModel: model, language })
    .then((result) => {
      console.log("\nResult:", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("Pipeline error:", err.message);
      process.exit(1);
    });
}
