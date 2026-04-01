/**
 * Pipeline Module — Phase 1 + Phase 2 + Phase 3 + Phase 4
 *
 * Phase 1: Ingest → Take Selection → Assembler (Long-form MP4)
 * Phase 2: Shorts Extraction → Per-Short Assembly (7-8 Short MP4s)
 * Phase 3: B-roll Automation — Index Library + Match + Place
 * Phase 4: Captions + Term Flashes — Remotion Overlay + FFmpeg Composite
 */

import { ingest } from "./ingest.js";
import { selectTakes } from "./take-selector.js";
import { assembleFromSegments, getVideoDuration } from "./assembler.js";
import { extractShortsFromTakes } from "./shorts-extractor.js";
import { detectFace, autoReframe } from "./auto-reframe.js";
import { indexLibrary, getIndexStats } from "./broll-indexer.js";
import { placeBrollLongform, placeBrollShort, formatBrollReport, computeBrollConfidence } from "./broll-placer.js";
import { generateCaptions } from "./transcreator.js";
import { extractTermFlashes } from "./term-identifier.js";
import { selectCaptionPreset } from "./brightness-analyzer.js";
import { renderAndComposite } from "./overlay-renderer.js";
import { mkdir } from "node:fs/promises";
import { writeFile, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

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

  // Step 3: Detect face for auto-reframe (once for the whole recording)
  console.log("\nSTEP 3: Face Detection (for auto-reframe)");
  console.log("─────────────────────────────────────");
  let faceResult;
  try {
    faceResult = await detectFace(recordingPath, { samples: 10 });
    if (faceResult.face_detected) {
      console.log(`  Face detected: center (${faceResult.center_x}, ${faceResult.center_y})`);
      console.log(`  Detections: ${faceResult.detections}/${faceResult.samples} frames`);
    } else {
      console.log("  No face detected — using frame center as fallback");
    }
  } catch (err) {
    console.log(`  Face detection failed: ${err.message} — using frame center`);
    faceResult = {
      face_detected: false,
      center_x: Math.round((mediaInfo.width || 1920) / 2),
      center_y: Math.round((mediaInfo.height || 1080) / 2),
      frame_width: mediaInfo.width || 1920,
      frame_height: mediaInfo.height || 1080,
    };
  }

  // Step 4: Assemble + Auto-Reframe each short
  console.log(`\nSTEP 4: Assemble + Reframe ${shortsResult.shorts.length} Shorts`);
  console.log("─────────────────────────────────────");

  const assembledShorts = [];

  for (const short of shortsResult.shorts) {
    // Compute speaking segments for this short (intersection with speaking segments)
    const shortSegments = computeFinalSegments(speakingSegments, [short]);

    if (shortSegments.length === 0) {
      console.log(`  Short ${short.id}: SKIPPED — no speaking segments overlap`);
      continue;
    }

    // Assemble 16:9 version first
    const shortHorizontalPath = join(shortsDir, `${recordingName}-short-${short.id}-16x9.mp4`);
    const shortVerticalPath = join(shortsDir, `${recordingName}-short-${short.id}.mp4`);

    console.log(`  Short ${short.id}: ${short.duration.toFixed(1)}s — assembling 16:9...`);
    await assembleFromSegments(recordingPath, shortSegments, shortHorizontalPath);

    // Auto-reframe to 9:16
    console.log(`  Short ${short.id}: reframing to 9:16...`);
    await autoReframe(shortHorizontalPath, shortVerticalPath, { faceResult });

    const actualDuration = await getVideoDuration(shortVerticalPath);
    assembledShorts.push({
      id: short.id,
      horizontalPath: shortHorizontalPath,
      verticalPath: shortVerticalPath,
      duration: actualDuration,
      text: short.text,
      confidence: short.confidence,
    });

    console.log(`  Short ${short.id}: ${actualDuration.toFixed(1)}s → ${shortVerticalPath}`);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`PHASE 2 COMPLETE — ${assembledShorts.length} Shorts created (16:9 + 9:16)`);
  console.log("═══════════════════════════════════════");

  const result = {
    recordingPath,
    shortsDir,
    shortsCount: assembledShorts.length,
    shorts: assembledShorts,
    faceDetection: faceResult,
    stats: shortsResult.stats,
    warnings: shortsResult.warnings,
  };

  // Save final result
  const resultPath = join(dataDir, `${recordingName}-phase2-result.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  return result;
}

/**
 * Phase 3 pipeline: B-roll Automation
 *
 * Steps:
 * 1. Index B-roll library (incremental — only new clips)
 * 2. Load transcript from Phase 1 data
 * 3. Match B-roll to long-form transcript (aggressive mode)
 * 4. Match B-roll to each short transcript (selective mode)
 * 5. Save placement manifests for later rendering
 */
export async function runPhase3(recordingPath, options = {}) {
  const {
    outputDir = "output",
    dataDir = "data",
    brollLibraryPath = null,
    brollDbPath = null,
  } = options;

  const recordingName = basename(recordingPath).replace(/\.[^.]+$/, "");
  const dbPath = brollDbPath || join(dataDir, "broll-index.db");

  console.log("═══════════════════════════════════════");
  console.log(`PHASE 3: B-roll Automation`);
  console.log(`Recording: ${basename(recordingPath)}`);
  console.log("═══════════════════════════════════════\n");

  // Step 1: Index B-roll library (if path provided)
  if (brollLibraryPath) {
    console.log("STEP 1: Index B-roll Library (incremental)");
    console.log("─────────────────────────────────────");

    const indexStats = await indexLibrary(brollLibraryPath, dbPath, {
      onProgress: (stats, result) => {
        if (result.action === "inserted") {
          console.log(`  + ${basename(result.filePath)}`);
        } else if (result.action === "updated") {
          console.log(`  ~ ${basename(result.filePath)}`);
        }
      },
    });

    console.log(`\n  Total scanned: ${indexStats.total}`);
    console.log(`  New clips:     ${indexStats.inserted}`);
    console.log(`  Updated:       ${indexStats.updated}`);
    console.log(`  Skipped:       ${indexStats.skipped}`);
    console.log(`  Errors:        ${indexStats.errors}\n`);
  } else if (!existsSync(dbPath)) {
    console.log("  No B-roll library path provided and no existing index found.");
    console.log("  Run: node src/broll-indexer.js index <library-path>");
    console.log("  Skipping B-roll placement.\n");

    return {
      recordingPath,
      longformManifest: { manifest: [], stats: { totalPlacements: 0, mode: "aggressive" }, warnings: ["No B-roll index"] },
      shortManifests: [],
      brollConfidence: "yellow",
    };
  } else {
    console.log("STEP 1: Using existing B-roll index");
    console.log("─────────────────────────────────────");
    const stats = getIndexStats(dbPath);
    console.log(`  Clips in index: ${stats.totalClips}`);
    console.log(`  Total duration: ${(stats.totalDuration / 60).toFixed(1)} min\n`);
  }

  // Step 2: Load transcript from Phase 1 data
  console.log("STEP 2: Load transcript");
  console.log("─────────────────────────────────────");

  let transcript;
  try {
    const transcriptPath = join(dataDir, `${recordingName}-transcript.json`);
    transcript = JSON.parse(await readFile(transcriptPath, "utf-8"));
    console.log(`  Loaded: ${transcript.segments.length} segments\n`);
  } catch {
    console.log("  Transcript not found — run Phase 1 first.\n");
    return {
      recordingPath,
      longformManifest: { manifest: [], stats: { totalPlacements: 0, mode: "aggressive" }, warnings: ["No transcript"] },
      shortManifests: [],
      brollConfidence: "yellow",
    };
  }

  // Step 3: Match B-roll to long-form transcript (aggressive mode)
  console.log("STEP 3: B-roll Matching — Long-form (aggressive, every 15-20s)");
  console.log("─────────────────────────────────────");

  const longformResult = placeBrollLongform(transcript.segments, dbPath);
  console.log(formatBrollReport(longformResult));

  // Save long-form manifest
  const longformManifestPath = join(dataDir, `${recordingName}-broll-longform.json`);
  await writeFile(longformManifestPath, JSON.stringify(longformResult, null, 2));
  console.log(`\n  Saved: ${longformManifestPath}\n`);

  // Step 4: Match B-roll to each short (selective mode)
  console.log("STEP 4: B-roll Matching — Shorts (selective, topic-relevant)");
  console.log("─────────────────────────────────────");

  const shortManifests = [];
  let shortsData;

  try {
    const shortsPath = join(dataDir, `${recordingName}-shorts.json`);
    shortsData = JSON.parse(await readFile(shortsPath, "utf-8"));
  } catch {
    console.log("  Shorts data not found — run Phase 2 first.");
    console.log("  Skipping short B-roll matching.\n");
    shortsData = null;
  }

  if (shortsData && shortsData.shorts) {
    for (const short of shortsData.shorts) {
      // Create segments for this short from the main transcript
      const shortSegments = transcript.segments.filter(
        seg => seg.start >= short.start && seg.end <= short.end
      );

      const shortResult = placeBrollShort(shortSegments, dbPath);
      shortManifests.push({
        shortId: short.id,
        ...shortResult,
      });

      const clipCount = shortResult.manifest.length;
      const confidence = computeBrollConfidence(shortResult);
      console.log(`  Short ${short.id}: ${clipCount} B-roll placement(s), confidence: ${confidence.toUpperCase()}`);
    }

    // Save short manifests
    const shortsManifestPath = join(dataDir, `${recordingName}-broll-shorts.json`);
    await writeFile(shortsManifestPath, JSON.stringify(shortManifests, null, 2));
    console.log(`\n  Saved: ${shortsManifestPath}`);
  }

  // Step 5: Summary
  const overallConfidence = computeBrollConfidence(longformResult);

  console.log(`\n═══════════════════════════════════════`);
  console.log(`PHASE 3 COMPLETE`);
  console.log(`  Long-form: ${longformResult.manifest.length} placements (${longformResult.stats.greenPlacements} green, ${longformResult.stats.yellowPlacements} yellow)`);
  console.log(`  Shorts: ${shortManifests.length} processed`);
  console.log(`  Overall confidence: ${overallConfidence.toUpperCase()}`);
  if (longformResult.warnings.length > 0) {
    console.log(`  Warnings: ${longformResult.warnings.length}`);
  }
  console.log("═══════════════════════════════════════");

  const result = {
    recordingPath,
    longformManifest: longformResult,
    shortManifests,
    brollConfidence: overallConfidence,
  };

  // Save full Phase 3 result
  const resultPath = join(dataDir, `${recordingName}-phase3-result.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  return result;
}

/**
 * Phase 4 pipeline: Captions + Term Flashes + Remotion Overlay + FFmpeg Composite
 *
 * Adds caption and term flash overlays to all videos from previous phases.
 * Processes longform video first, then each short, sequentially (16GB constraint).
 *
 * Steps:
 * 1. Load transcript from Phase 1 data
 * 2. Generate captions (transcreate if Hindi/Hinglish)
 * 3. Identify technical terms and key claims
 * 4. Analyze brightness → select caption preset
 * 5. Render Remotion overlay + FFmpeg composite for longform
 * 6. Render Remotion overlay + FFmpeg composite for each short
 */
export async function runPhase4(recordingPath, options = {}) {
  const {
    outputDir = "output",
    dataDir = "data",
    manualPreset = null,
  } = options;

  const recordingName = basename(recordingPath).replace(/\.[^.]+$/, "");

  console.log("═══════════════════════════════════════");
  console.log(`PHASE 4: Captions + Term Flashes`);
  console.log(`Recording: ${basename(recordingPath)}`);
  console.log("═══════════════════════════════════════\n");

  // Step 1: Load transcript
  console.log("STEP 1: Load transcript");
  console.log("─────────────────────────────────────");

  let transcript;
  try {
    const transcriptPath = join(dataDir, `${recordingName}-transcript.json`);
    transcript = JSON.parse(await readFile(transcriptPath, "utf-8"));
    console.log(`  Loaded: ${transcript.segments.length} segments, language: ${transcript.language}\n`);
  } catch {
    throw new Error("Transcript not found — run Phase 1 first");
  }

  // Step 2: Generate captions
  console.log("STEP 2: Generate Captions (transcreate if needed)");
  console.log("─────────────────────────────────────");

  const captionResult = await generateCaptions(transcript);

  console.log(`  Total captions:   ${captionResult.stats.totalCaptions}`);
  console.log(`  Direct (English): ${captionResult.stats.directCount}`);
  console.log(`  Transcreated:     ${captionResult.stats.transcreatedCount}`);
  console.log(`  Language:         ${captionResult.stats.language}\n`);

  // Save captions
  const captionsPath = join(dataDir, `${recordingName}-captions.json`);
  await writeFile(captionsPath, JSON.stringify(captionResult, null, 2));

  // Step 3: Identify terms and claims
  console.log("STEP 3: Identify Terms + Key Claims");
  console.log("─────────────────────────────────────");

  const termResult = await extractTermFlashes(transcript);

  console.log(`  Total flashes:  ${termResult.stats.totalFlashes}`);
  console.log(`  Terms:          ${termResult.stats.terms}`);
  console.log(`  Claims:         ${termResult.stats.claims}\n`);

  // Save term flashes
  const termsPath = join(dataDir, `${recordingName}-termflashes.json`);
  await writeFile(termsPath, JSON.stringify(termResult, null, 2));

  // Step 4: Process longform video
  const longformPath = join(outputDir, `${recordingName}-edited.mp4`);
  const longformFinalPath = join(outputDir, `${recordingName}-final.mp4`);
  const results = { longform: null, shorts: [] };

  if (existsSync(longformPath)) {
    console.log("STEP 4: Longform — Brightness Analysis + Overlay");
    console.log("─────────────────────────────────────");

    const presetResult = await selectCaptionPreset(longformPath, { manualPreset });
    console.log(`  Preset: ${presetResult.preset} (source: ${presetResult.source})`);
    if (presetResult.analysis) {
      console.log(`  Mean luminance: ${presetResult.analysis.meanLuminance}`);
    }

    const longformDuration = await getVideoDuration(longformPath);
    console.log(`  Duration: ${(longformDuration / 60).toFixed(1)} min`);
    console.log(`  Rendering Remotion overlay + compositing...`);

    const longformResult = await renderAndComposite({
      baseVideoPath: longformPath,
      captions: captionResult.captions,
      termFlashes: termResult.termFlashes,
      captionPreset: presetResult.preset,
      captionStyle: "longform",
      durationInSeconds: longformDuration,
      width: 1920,
      height: 1080,
      outputPath: longformFinalPath,
      compositionId: "CaptionOverlay",
    });

    results.longform = {
      outputPath: longformFinalPath,
      preset: presetResult.preset,
      presetSource: presetResult.source,
      captionCount: captionResult.stats.totalCaptions,
      termFlashCount: termResult.stats.totalFlashes,
      duration: longformDuration,
    };

    console.log(`  Output: ${longformFinalPath}\n`);
  } else {
    console.log("STEP 4: Longform — SKIPPED (no edited video found)\n");
  }

  // Step 5: Process each short
  console.log("STEP 5: Shorts — Overlay + Composite");
  console.log("─────────────────────────────────────");

  let phase2Result;
  try {
    const phase2Path = join(dataDir, `${recordingName}-phase2-result.json`);
    phase2Result = JSON.parse(await readFile(phase2Path, "utf-8"));
  } catch {
    console.log("  Phase 2 data not found — skipping shorts overlay.\n");
    phase2Result = null;
  }

  if (phase2Result && Array.isArray(phase2Result.shorts)) {
    for (const short of phase2Result.shorts) {
      const shortVideoPath = short.verticalPath;

      if (!shortVideoPath || !existsSync(shortVideoPath)) {
        console.log(`  Short ${short.id}: SKIPPED — video not found`);
        continue;
      }

      // Analyze brightness per-short
      const shortPreset = await selectCaptionPreset(shortVideoPath, { manualPreset });

      // Filter captions and term flashes for this short's time range
      const shortCaptions = filterEntriesForShort(captionResult.captions, short);
      const shortTermFlashes = filterEntriesForShort(termResult.termFlashes, short);

      const shortDuration = short.duration || await getVideoDuration(shortVideoPath);

      // Rebase timestamps to start from 0 for the short
      const rebasedCaptions = rebaseTimestamps(shortCaptions, short);
      const rebasedTermFlashes = rebaseTimestamps(shortTermFlashes, short);

      const shortFinalPath = shortVideoPath.replace(/\.mp4$/, "-captioned.mp4");

      console.log(`  Short ${short.id}: ${shortDuration.toFixed(1)}s, preset: ${shortPreset.preset}, ${rebasedCaptions.length} captions, ${rebasedTermFlashes.length} flashes`);

      await renderAndComposite({
        baseVideoPath: shortVideoPath,
        captions: rebasedCaptions,
        termFlashes: rebasedTermFlashes,
        captionPreset: shortPreset.preset,
        captionStyle: "short",
        durationInSeconds: shortDuration,
        width: 1080,
        height: 1920,
        outputPath: shortFinalPath,
        compositionId: "CaptionOverlayVertical",
      });

      results.shorts.push({
        id: short.id,
        outputPath: shortFinalPath,
        preset: shortPreset.preset,
        captionCount: rebasedCaptions.length,
        termFlashCount: rebasedTermFlashes.length,
        duration: shortDuration,
      });

      console.log(`  Short ${short.id}: → ${shortFinalPath}`);
    }
  }

  // Step 6: Summary
  console.log(`\n═══════════════════════════════════════`);
  console.log(`PHASE 4 COMPLETE`);
  if (results.longform) {
    console.log(`  Longform: ${results.longform.outputPath}`);
    console.log(`    Captions: ${results.longform.captionCount}, Term Flashes: ${results.longform.termFlashCount}`);
    console.log(`    Preset: ${results.longform.preset} (${results.longform.presetSource})`);
  }
  console.log(`  Shorts processed: ${results.shorts.length}`);
  for (const s of results.shorts) {
    console.log(`    Short ${s.id}: ${s.captionCount} captions, ${s.termFlashCount} flashes`);
  }
  console.log("═══════════════════════════════════════");

  // Save Phase 4 result
  const resultPath = join(dataDir, `${recordingName}-phase4-result.json`);
  await writeFile(resultPath, JSON.stringify(results, null, 2));

  return results;
}

/**
 * Filter caption/term flash entries that fall within a short's time range.
 *
 * @param {Array} entries - [{start, end, ...}]
 * @param {Object} short - {start, end, ...} from Phase 2 shorts data
 * @returns {Array} Filtered entries
 */
export function filterEntriesForShort(entries, short) {
  if (!Array.isArray(entries) || !short) return [];

  // Reject shorts without valid time bounds — Phase 2 assembled shorts
  // may lack start/end if they came from a different data path
  if (typeof short.start !== "number" || typeof short.end !== "number") return [];

  const shortStart = short.start;
  const shortEnd = short.end;

  return entries.filter(entry => {
    if (!entry || typeof entry.start !== "number" || typeof entry.end !== "number") return false;
    // Include if there's any overlap
    return entry.start < shortEnd && entry.end > shortStart;
  });
}

/**
 * Rebase timestamps so they start from 0 (relative to the short's start).
 *
 * @param {Array} entries - [{start, end, ...}]
 * @param {Object} short - {start, end, ...} short with original timestamps
 * @returns {Array} Entries with rebased timestamps
 */
export function rebaseTimestamps(entries, short) {
  if (!Array.isArray(entries) || !short) return [];

  // Reject shorts without valid time bounds
  if (typeof short.start !== "number" || typeof short.end !== "number") return [];

  const offset = short.start;
  // Use assembled duration if available (silence-cut shorts are shorter than end-start)
  const shortDuration = (typeof short.duration === "number" && short.duration > 0)
    ? short.duration
    : short.end - offset;

  return entries.map(entry => ({
    ...entry,
    start: Math.max(0, entry.start - offset),
    end: Math.min(shortDuration, entry.end - offset),
  }));
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
  } else if (phase === "3") {
    const brollLibraryPath = process.argv[4] || null;
    runPhase3(recordingPath, { brollLibraryPath })
      .then((result) => {
        console.log("\nResult:", JSON.stringify(result, null, 2));
      })
      .catch((err) => {
        console.error("Pipeline error:", err.message);
        process.exit(1);
      });
  } else if (phase === "4") {
    const manualPreset = process.argv[4] || null;
    runPhase4(recordingPath, { manualPreset })
      .then((result) => {
        console.log("\nResult:", JSON.stringify(result, null, 2));
      })
      .catch((err) => {
        console.error("Pipeline error:", err.message);
        process.exit(1);
      });
  }
}
