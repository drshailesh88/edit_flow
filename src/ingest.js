/**
 * Ingest Module
 *
 * Takes a raw Recording path, extracts audio, runs Whisper transcription,
 * and produces a Transcript JSON with word-level timestamps.
 *
 * Also detects silence gaps using FFmpeg silencedetect.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Get video metadata using ffprobe
 */
export async function getMediaInfo(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams.find((s) => s.codec_type === "video");
  const audioStream = data.streams.find((s) => s.codec_type === "audio");

  return {
    duration: parseFloat(data.format.duration),
    width: videoStream ? parseInt(videoStream.width) : null,
    height: videoStream ? parseInt(videoStream.height) : null,
    fps: videoStream ? eval(videoStream.r_frame_rate) : null,
    audioSampleRate: audioStream ? parseInt(audioStream.sample_rate) : null,
    audioChannels: audioStream ? parseInt(audioStream.channels) : null,
    filePath,
  };
}

/**
 * Extract audio from video as WAV for Whisper
 */
export async function extractAudio(videoPath, outputDir) {
  const audioPath = join(outputDir, basename(videoPath, ".MP4") + ".wav");
  // Also handle .mp4 lowercase
  const finalPath = audioPath.replace(/\.MP4\.wav$/, ".wav");

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    finalPath.endsWith(".wav") ? finalPath : audioPath,
  ]);

  const outPath = existsSync(finalPath) ? finalPath : audioPath;
  return outPath;
}

/**
 * Run Whisper transcription via Python script
 * Returns transcript JSON with word-level timestamps
 */
export async function transcribe(filePath, options = {}) {
  const { model = "medium", language = null } = options;
  const scriptPath = join(decodeURIComponent(dirname(new URL(import.meta.url).pathname)), "..", "scripts", "transcribe.py");

  const args = ["python3", scriptPath, filePath, "--model", model];
  if (language) {
    args.push("--language", language);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data; });
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper transcription failed (code ${code}): ${stderr}`));
        return;
      }
      try {
        // Whisper may print non-JSON lines before the JSON output
        // Find the first '{' and parse from there
        const jsonStart = stdout.indexOf("{");
        if (jsonStart === -1) {
          reject(new Error(`No JSON found in Whisper output: ${stdout.slice(0, 500)}`));
          return;
        }
        const transcript = JSON.parse(stdout.slice(jsonStart));
        resolve(transcript);
      } catch (e) {
        reject(new Error(`Failed to parse Whisper output: ${e.message}\nOutput: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

/**
 * Detect silence in audio using FFmpeg silencedetect
 * Returns array of { start, end, duration } for each silence gap
 */
export async function detectSilence(filePath, options = {}) {
  const { threshold = "-25dB", minDuration = 0.3 } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", filePath,
      "-af", `silencedetect=noise=${threshold}:d=${minDuration}`,
      "-f", "null",
      "-",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      // silencedetect outputs to stderr even on success
      const silences = [];
      const startRegex = /silence_start: ([\d.]+)/g;
      const endRegex = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g;

      const starts = [];
      let match;
      while ((match = startRegex.exec(stderr)) !== null) {
        starts.push(parseFloat(match[1]));
      }

      let i = 0;
      while ((match = endRegex.exec(stderr)) !== null) {
        silences.push({
          start: starts[i] || 0,
          end: parseFloat(match[1]),
          duration: parseFloat(match[2]),
        });
        i++;
      }

      resolve(silences);
    });
  });
}

/**
 * From silence gaps, compute speaking segments (the inverse)
 * Returns array of { start, end } for speaking regions
 */
export function getSpeakingSegments(silences, totalDuration, options = {}) {
  const { startPadding = 0, endPadding = 0.08 } = options;

  if (silences.length === 0) {
    return [{ start: 0, end: totalDuration }];
  }

  const segments = [];

  // Before first silence
  if (silences[0].start > 0.1) {
    segments.push({
      start: Math.max(0, 0 - startPadding),
      end: Math.min(silences[0].start + endPadding, totalDuration),
    });
  }

  // Between silences
  for (let i = 0; i < silences.length - 1; i++) {
    const segStart = silences[i].end - startPadding;
    const segEnd = silences[i + 1].start + endPadding;
    if (segEnd - segStart > 0.1) {
      segments.push({
        start: Math.max(0, segStart),
        end: Math.min(segEnd, totalDuration),
      });
    }
  }

  // After last silence
  const lastSilence = silences[silences.length - 1];
  if (lastSilence.end < totalDuration - 0.1) {
    segments.push({
      start: Math.max(0, lastSilence.end - startPadding),
      end: totalDuration,
    });
  }

  return segments;
}

/**
 * Full ingest pipeline:
 * 1. Get media info
 * 2. Detect silence
 * 3. Compute speaking segments
 * 4. Run Whisper transcription
 * 5. Save transcript + segments to output dir
 */
export async function ingest(recordingPath, outputDir, options = {}) {
  const { whisperModel = "medium", language = null } = options;

  await mkdir(outputDir, { recursive: true });

  console.log(`[ingest] Getting media info for ${basename(recordingPath)}...`);
  const mediaInfo = await getMediaInfo(recordingPath);
  console.log(`[ingest] Duration: ${(mediaInfo.duration / 60).toFixed(1)} min, ${mediaInfo.width}x${mediaInfo.height}`);

  console.log("[ingest] Detecting silence...");
  const silences = await detectSilence(recordingPath);
  console.log(`[ingest] Found ${silences.length} silence gaps`);

  const speakingSegments = getSpeakingSegments(silences, mediaInfo.duration);
  console.log(`[ingest] ${speakingSegments.length} speaking segments`);

  console.log(`[ingest] Transcribing with Whisper (model: ${whisperModel})...`);
  const transcript = await transcribe(recordingPath, {
    model: whisperModel,
    language,
  });
  console.log(`[ingest] Transcription complete: ${transcript.segments.length} segments, language: ${transcript.language}`);

  // Save outputs
  const recordingName = basename(recordingPath).replace(/\.[^.]+$/, "");
  const transcriptPath = join(outputDir, `${recordingName}-transcript.json`);
  const silencePath = join(outputDir, `${recordingName}-silences.json`);
  const segmentsPath = join(outputDir, `${recordingName}-speaking-segments.json`);

  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
  await writeFile(silencePath, JSON.stringify(silences, null, 2));
  await writeFile(segmentsPath, JSON.stringify(speakingSegments, null, 2));

  console.log(`[ingest] Saved to ${outputDir}/`);

  return {
    mediaInfo,
    transcript,
    silences,
    speakingSegments,
    files: { transcriptPath, silencePath, segmentsPath },
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("ingest.js") && process.argv[2]) {
  const recordingPath = process.argv[2];
  const outputDir = process.argv[3] || "data";
  const model = process.argv[4] || "medium";

  ingest(recordingPath, outputDir, { whisperModel: model })
    .then(() => console.log("[ingest] Done."))
    .catch((err) => {
      console.error("[ingest] Error:", err.message);
      process.exit(1);
    });
}
