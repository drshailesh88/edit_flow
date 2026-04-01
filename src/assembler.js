/**
 * FFmpeg Assembler Module
 *
 * Takes speaking segments and a source Recording, cuts out silence,
 * and concatenates into a final MP4.
 *
 * Uses FFmpeg complex filter for single-pass assembly (no intermediate files).
 */

import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * Assemble speaking segments into a single MP4 using FFmpeg concat filter.
 *
 * Strategy: Use the select/aselect filter to pick speaking regions,
 * then concatenate them. This avoids creating intermediate clip files.
 *
 * For reliability with complex edits, we use the concat demuxer approach:
 * 1. Create individual clips as temp files
 * 2. Concat with concat demuxer
 * 3. Clean up temps
 *
 * This is more reliable than complex filtergraphs for many segments.
 */
export async function assembleFromSegments(recordingPath, segments, outputPath, options = {}) {
  const { audioNormalize = true } = options;

  if (segments.length === 0) {
    throw new Error("No speaking segments to assemble");
  }

  await mkdir(join(outputPath, ".."), { recursive: true });

  // For a small number of segments, use the trim+concat filter approach (single pass)
  // For many segments, fall back to concat demuxer
  if (segments.length <= 50) {
    return assembleSinglePass(recordingPath, segments, outputPath, { audioNormalize });
  } else {
    return assembleConcatDemuxer(recordingPath, segments, outputPath, { audioNormalize });
  }
}

/**
 * Single-pass assembly using FFmpeg trim + concat filter.
 * More efficient — no intermediate files, one FFmpeg process.
 */
async function assembleSinglePass(recordingPath, segments, outputPath, options = {}) {
  const { audioNormalize = true } = options;
  const n = segments.length;

  // Build complex filter
  // For each segment: trim video and audio, then concat all
  let filterParts = [];
  let concatInputs = "";

  for (let i = 0; i < n; i++) {
    const { start, end } = segments[i];
    filterParts.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`
    );
    filterParts.push(
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatInputs += `[v${i}][a${i}]`;
  }

  let filterComplex = filterParts.join(";\n");
  filterComplex += `;\n${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`;

  if (audioNormalize) {
    filterComplex += `;\n[outa]loudnorm=I=-16:TP=-1.5:LRA=11[outnorm]`;
  }

  const args = [
    "-y",
    "-i", recordingPath,
    "-filter_complex", filterComplex,
    "-map", audioNormalize ? "[outv]" : "[outv]",
    "-map", audioNormalize ? "[outnorm]" : "[outa]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];

  return runFFmpeg(args);
}

/**
 * Concat demuxer approach for many segments.
 * Creates a file list and uses -f concat.
 */
async function assembleConcatDemuxer(recordingPath, segments, outputPath, options = {}) {
  const { audioNormalize = true } = options;
  const tempDir = join(outputPath, "..", ".temp-clips");
  await mkdir(tempDir, { recursive: true });

  // Extract each segment as a clip
  const clipPaths = [];
  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    const clipPath = join(tempDir, `clip-${String(i).padStart(4, "0")}.mp4`);
    clipPaths.push(clipPath);

    await runFFmpeg([
      "-y",
      "-ss", String(start),
      "-to", String(end),
      "-i", recordingPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      clipPath,
    ]);
  }

  // Write concat file list
  const concatListPath = join(tempDir, "concat-list.txt");
  const concatContent = clipPaths.map((p) => `file '${p}'`).join("\n");
  await writeFile(concatListPath, concatContent);

  // Concat
  const concatArgs = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    outputPath,
  ];

  await runFFmpeg(concatArgs);

  // Normalize audio if requested (separate pass)
  if (audioNormalize) {
    const tempNorm = outputPath.replace(".mp4", "-norm.mp4");
    await runFFmpeg([
      "-y",
      "-i", outputPath,
      "-c:v", "copy",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "aac",
      "-b:a", "192k",
      tempNorm,
    ]);
    await unlink(outputPath);
    const { rename } = await import("node:fs/promises");
    await rename(tempNorm, outputPath);
  }

  // Clean up temp clips
  for (const p of clipPaths) {
    await unlink(p).catch(() => {});
  }
  await unlink(concatListPath).catch(() => {});
  const { rmdir } = await import("node:fs/promises");
  await rmdir(tempDir).catch(() => {});

  return outputPath;
}

/**
 * Run an FFmpeg command and return a promise
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get duration of a video file
 */
export async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    proc.stdout.on("data", (data) => { stdout += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("ffprobe failed"));
        return;
      }
      const data = JSON.parse(stdout);
      resolve(parseFloat(data.format.duration));
    });
  });
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("assembler.js") && process.argv[2]) {
  const segmentsFile = process.argv[2];
  const recordingPath = process.argv[3];
  const outputPath = process.argv[4] || "output/assembled.mp4";

  import("node:fs/promises").then(async ({ readFile }) => {
    const segments = JSON.parse(await readFile(segmentsFile, "utf-8"));
    console.log(`[assembler] ${segments.length} segments from ${basename(recordingPath)}`);
    await assembleFromSegments(recordingPath, segments, outputPath);
    const dur = await getVideoDuration(outputPath);
    console.log(`[assembler] Output: ${outputPath} (${(dur / 60).toFixed(1)} min)`);
  }).catch((err) => {
    console.error("[assembler] Error:", err.message);
    process.exit(1);
  });
}
