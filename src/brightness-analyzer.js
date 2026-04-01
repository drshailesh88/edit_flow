/**
 * Brightness Analyzer Module — Phase 4
 *
 * Analyzes video luminance using FFmpeg to auto-select caption preset.
 * - Dark scenes → "white-on-black" preset
 * - Bright scenes → "black-on-white" preset
 *
 * Also supports manual preset override.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Analyze average luminance of a video using FFmpeg signalstats filter.
 * Samples frames across the video and returns the mean Y (luma) value.
 *
 * Y values: 0 = black, 255 = white. Typical video: 80-180.
 *
 * @param {string} videoPath - Path to video file
 * @param {Object} options - { sampleFrames }
 * @returns {Promise<Object>} { meanLuminance, isDark, recommendedPreset }
 */
export async function analyzeBrightness(videoPath, options = {}) {
  if (!videoPath || typeof videoPath !== "string") {
    throw new Error("videoPath is required and must be a string");
  }

  const { sampleFrames = 30 } = options;

  // Use FFmpeg signalstats to measure luminance across sampled frames
  // -vf select='not(mod(n,N))' samples every Nth frame
  // signalstats outputs YAVG (average Y luminance per frame)
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vf", `select='not(mod(n\\,${sampleFrames}))',signalstats`,
    "-f", "null",
    "-",
  ], { maxBuffer: 10 * 1024 * 1024 });

  const luminanceValues = parseLuminanceFromStats(stderr);

  if (luminanceValues.length === 0) {
    // Fallback: can't determine luminance, default to white-on-black
    return {
      meanLuminance: null,
      isDark: true,
      recommendedPreset: "white-on-black",
      sampledFrames: 0,
    };
  }

  const meanLuminance = luminanceValues.reduce((sum, v) => sum + v, 0) / luminanceValues.length;

  // Threshold: Y < 128 is "dark", >= 128 is "bright"
  const isDark = meanLuminance < 128;
  const recommendedPreset = isDark ? "white-on-black" : "black-on-white";

  return {
    meanLuminance: Math.round(meanLuminance * 10) / 10,
    isDark,
    recommendedPreset,
    sampledFrames: luminanceValues.length,
  };
}

/**
 * Parse YAVG luminance values from FFmpeg signalstats stderr output.
 *
 * FFmpeg outputs lines like:
 *   [Parsed_signalstats_1 @ 0x...] YAVG: 142.3 ...
 *
 * @param {string} stderr - FFmpeg stderr output
 * @returns {Array<number>} Luminance values
 */
export function parseLuminanceFromStats(stderr) {
  if (!stderr || typeof stderr !== "string") return [];

  const values = [];
  const regex = /YAVG:\s*([\d.]+)/g;
  let match;

  while ((match = regex.exec(stderr)) !== null) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val >= 0 && val <= 255) {
      values.push(val);
    }
  }

  return values;
}

/**
 * Select caption preset for a video.
 *
 * Priority:
 * 1. Manual override (if provided)
 * 2. Auto-detection via FFmpeg luminance analysis
 * 3. Default ("white-on-black")
 *
 * @param {string} videoPath - Path to video file
 * @param {Object} options - { manualPreset, sampleFrames }
 * @returns {Promise<Object>} { preset, source, analysis }
 */
export async function selectCaptionPreset(videoPath, options = {}) {
  const { manualPreset = null, sampleFrames = 30 } = options;

  const validPresets = ["white-on-black", "black-on-white"];

  // Priority 1: Manual override
  if (manualPreset) {
    if (!validPresets.includes(manualPreset)) {
      throw new Error(`Invalid preset "${manualPreset}". Valid: ${validPresets.join(", ")}`);
    }
    return {
      preset: manualPreset,
      source: "manual",
      analysis: null,
    };
  }

  // Priority 2: Auto-detection
  try {
    const analysis = await analyzeBrightness(videoPath, { sampleFrames });
    return {
      preset: analysis.recommendedPreset,
      source: "auto",
      analysis,
    };
  } catch {
    // Priority 3: Default fallback
    return {
      preset: "white-on-black",
      source: "default",
      analysis: null,
    };
  }
}
