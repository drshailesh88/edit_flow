/**
 * Pipeline Module — Phase 1 Tracer Bullet
 *
 * Connects Ingest → Assembler for the simplest end-to-end flow:
 * Raw Recording → silence-removed, assembled MP4
 */

import { ingest } from "./ingest.js";
import { assembleFromSegments, getVideoDuration } from "./assembler.js";
import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * Phase 1 pipeline: Recording → silence-removed MP4
 *
 * Steps:
 * 1. Ingest (transcribe + detect silence + compute speaking segments)
 * 2. Assemble (cut silence, concatenate speaking segments)
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
  console.log(`  Transcript:       ${transcript.segments.length} segments, ${transcript.language}\n`);

  // Step 2: Assemble
  console.log("STEP 2: Assemble (cut + concatenate)");
  console.log("─────────────────────────────────────");
  await assembleFromSegments(recordingPath, speakingSegments, outputPath);

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
    segmentCount: speakingSegments.length,
    transcriptSegments: transcript.segments.length,
    language: transcript.language,
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("pipeline.js") && process.argv[2]) {
  const recordingPath = process.argv[2];
  const model = process.argv[3] || "medium";

  runPhase1(recordingPath, { whisperModel: model })
    .then((result) => {
      console.log("\nResult:", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("Pipeline error:", err.message);
      process.exit(1);
    });
}
