/**
 * Pipeline Module — Phase 1 + Phase 2
 *
 * Phase 1: Ingest → Take Selection → Assembler (Long-form MP4)
 * Phase 2: Shorts Extraction → Per-Short Assembly (7-8 Short MP4s)
 */

import { ingest } from "./ingest.js";
import { selectTakes } from "./take-selector.js";
import { assembleFromSegments, getVideoDuration } from "./assembler.js";
import { extractShortsFromTakes } from "./shorts-extractor.js";
import { mkdir } from "node:fs/promises";
import { writeFile, readFile } from "node:fs/promises";
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

/**
 * Phase 2 pipeline: Recording → 7-8 individual Short MP4s
 *
 * Can run standalone (re-ingests) or use Phase 1 output data.
 *
 * Steps:
 * 1. Load or run ingest + take selection
 * 2. Extract shorts (identify sections, validate duration)
 * 3. Compute per-short speaking segments (intersection)
 * 4. Assemble each short as an individual MP4
 */
export async function runPhase2(recordingPath, options = {}) {
  const {
    outputDir = "output",
    dataDir = "data",
    whisperModel = "medium",
    language = null,
    reusePhase1 = true,
  } = options;

  const shortsDir = join(outputDir, "shorts");
  await mkdir(shortsDir, { recursive: true });

  const recordingName = basename(recordingPath).replace(/\.[^.]+$/, "");

  console.log("═══════════════════════════════════════");
  console.log(`PHASE 2: Shorts Extraction`);
  console.log(`Recording: ${basename(recordingPath)}`);
  console.log("═══════════════════════════════════════\n");

  // Step 1: Get transcript and take selection (reuse Phase 1 data if available)
  let speakingSegments, takeResult, mediaInfo;

  if (reusePhase1) {
    try {
      const transcriptPath = join(dataDir, `${recordingName}-transcript.json`);
      const segmentsPath = join(dataDir, `${recordingName}-speaking-segments.json`);
      const transcript = JSON.parse(await readFile(transcriptPath, "utf-8"));
      speakingSegments = JSON.parse(await readFile(segmentsPath, "utf-8"));
      mediaInfo = await import("./ingest.js").then(m => m.getMediaInfo(recordingPath));
      takeResult = selectTakes(transcript);
      console.log("  Reusing Phase 1 data from disk\n");
    } catch {
      console.log("  Phase 1 data not found, running ingest...\n");
      reusePhase1 = false;
    }
  }

  if (!reusePhase1) {
    console.log("STEP 1: Ingest (transcribe + silence detection)");
    console.log("─────────────────────────────────────");
    const ingestResult = await ingest(recordingPath, dataDir, { whisperModel, language });
    mediaInfo = ingestResult.mediaInfo;
    speakingSegments = ingestResult.speakingSegments;
    takeResult = selectTakes(ingestResult.transcript);
  }

  // Step 2: Extract shorts
  console.log("STEP 2: Extract Shorts (identify sections)");
  console.log("─────────────────────────────────────");
  const shortsResult = extractShortsFromTakes(takeResult);

  console.log(`  Sections found:   ${shortsResult.stats.totalSections}`);
  console.log(`  Shorts to create: ${shortsResult.stats.totalShorts}`);
  console.log(`  Green (< 60s):    ${shortsResult.stats.greenShorts}`);
  console.log(`  Yellow (>= 60s):  ${shortsResult.stats.yellowShorts}`);
  if (shortsResult.warnings.length > 0) {
    for (const w of shortsResult.warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  // Save shorts metadata
  const shortsMetaPath = join(dataDir, `${recordingName}-shorts.json`);
  await writeFile(shortsMetaPath, JSON.stringify(shortsResult, null, 2));

  // Step 3: Assemble each short
  console.log(`\nSTEP 3: Assemble ${shortsResult.shorts.length} Shorts`);
  console.log("─────────────────────────────────────");

  const assembledShorts = [];

  for (const short of shortsResult.shorts) {
    // Compute speaking segments for this short (intersection with speaking segments)
    const shortSegments = computeFinalSegments(speakingSegments, [short]);

    if (shortSegments.length === 0) {
      console.log(`  Short ${short.id}: SKIPPED — no speaking segments overlap`);
      continue;
    }

    const shortOutputPath = join(shortsDir, `${recordingName}-short-${short.id}.mp4`);

    console.log(`  Short ${short.id}: ${short.duration.toFixed(1)}s — assembling...`);
    await assembleFromSegments(recordingPath, shortSegments, shortOutputPath);

    const actualDuration = await getVideoDuration(shortOutputPath);
    assembledShorts.push({
      id: short.id,
      path: shortOutputPath,
      duration: actualDuration,
      text: short.text,
      confidence: short.confidence,
    });

    console.log(`  Short ${short.id}: ${actualDuration.toFixed(1)}s → ${shortOutputPath}`);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`PHASE 2 COMPLETE — ${assembledShorts.length} Shorts created`);
  console.log("═══════════════════════════════════════");

  const result = {
    recordingPath,
    shortsDir,
    shortsCount: assembledShorts.length,
    shorts: assembledShorts,
    stats: shortsResult.stats,
    warnings: shortsResult.warnings,
  };

  // Save final result
  const resultPath = join(dataDir, `${recordingName}-phase2-result.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  return result;
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("pipeline.js") && process.argv[2]) {
  const phase = process.argv[2];
  const recordingPath = process.argv[3];
  const model = process.argv[4] || "medium";
  const language = process.argv[5] || null;

  if (phase === "1" || !recordingPath) {
    // Phase 1 (or legacy: pipeline.js <recording>)
    const path = recordingPath || phase;
    runPhase1(path, { whisperModel: model, language })
      .then((result) => {
        console.log("\nResult:", JSON.stringify(result, null, 2));
      })
      .catch((err) => {
        console.error("Pipeline error:", err.message);
        process.exit(1);
      });
  } else if (phase === "2") {
    runPhase2(recordingPath, { whisperModel: model, language })
      .then((result) => {
        console.log("\nResult:", JSON.stringify(result, null, 2));
      })
      .catch((err) => {
        console.error("Pipeline error:", err.message);
        process.exit(1);
      });
  }
}
