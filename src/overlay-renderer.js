/**
 * Overlay Renderer Module — Phase 4 Pipeline Integration
 *
 * Renders Remotion overlay (transparent ProRes 4444) and composites onto video via FFmpeg.
 *
 * Steps:
 * 1. Bundle Remotion project (once, cached)
 * 2. Render overlay as ProRes 4444 with alpha
 * 3. Composite overlay onto base video with FFmpeg
 * 4. Normalize audio (loudnorm)
 *
 * Constraints:
 * - Only 1 Remotion render at a time (mutex)
 * - Sequential processing to stay within 16GB
 */

import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// Remotion render mutex — only 1 render at a time
let renderLock = null;

/**
 * Acquire the Remotion render mutex.
 * Returns a release function.
 */
export function acquireRenderLock() {
  const acquire = () => {
    if (renderLock === null) {
      let releaseFn;
      renderLock = new Promise((resolve) => {
        releaseFn = () => {
          renderLock = null;
          resolve();
        };
      });
      return releaseFn;
    }
    return null;
  };

  return new Promise((resolveAcquire) => {
    const release = acquire();
    if (release) {
      resolveAcquire(release);
      return;
    }

    // Wait for current lock to release, then acquire
    const waitAndAcquire = () => {
      const currentLock = renderLock;
      if (currentLock === null) {
        const release = acquire();
        resolveAcquire(release);
        return;
      }
      currentLock.then(() => {
        const release = acquire();
        if (release) {
          resolveAcquire(release);
        } else {
          waitAndAcquire();
        }
      });
    };
    waitAndAcquire();
  });
}

/**
 * Reset the render lock (for testing).
 */
export function resetRenderLock() {
  renderLock = null;
}

/**
 * Render a Remotion overlay as transparent ProRes 4444.
 *
 * Uses the Remotion CLI (`npx remotion render`) to produce a .mov with alpha channel.
 *
 * @param {Object} params
 * @param {Array} params.captions - Caption entries [{id, start, end, text}]
 * @param {Array} params.termFlashes - Term flash entries [{id, start, end, text, type}]
 * @param {Array} params.chapterTitles - Chapter title entries [{id, start, end, text}] (longform only)
 * @param {string} params.captionPreset - "white-on-black" | "black-on-white"
 * @param {string} params.captionStyle - "short" | "longform"
 * @param {number} params.durationInSeconds - Video duration
 * @param {number} params.fps - Frames per second (default 30)
 * @param {number} params.width - Video width
 * @param {number} params.height - Video height
 * @param {string} params.outputPath - Output .mov path
 * @param {string} params.compositionId - "CaptionOverlay" | "CaptionOverlayVertical"
 * @returns {Promise<string>} Path to rendered overlay
 */
export async function renderOverlay(params) {
  const {
    captions = [],
    termFlashes = [],
    chapterTitles = [],
    captionPreset = "white-on-black",
    captionStyle = "short",
    durationInSeconds,
    fps = 30,
    width = 1920,
    height = 1080,
    outputPath,
    compositionId = "CaptionOverlay",
  } = params;

  if (!outputPath) throw new Error("outputPath is required");
  if (!durationInSeconds || durationInSeconds <= 0) {
    throw new Error("durationInSeconds must be positive");
  }

  await mkdir(dirname(outputPath), { recursive: true });

  const durationInFrames = Math.ceil(durationInSeconds * fps);

  // Write inputProps to a temp file (avoids shell escaping issues with complex JSON)
  const propsPath = outputPath.replace(/\.[^.]+$/, "-props.json");
  const inputProps = {
    captions,
    termFlashes,
    chapterTitles,
    captionPreset,
    captionStyle,
    videoWidth: width,
    videoHeight: height,
  };
  await writeFile(propsPath, JSON.stringify(inputProps));

  // Acquire mutex — only 1 Remotion render at a time
  const release = await acquireRenderLock();

  try {
    const args = [
      "remotion", "render",
      compositionId,
      outputPath,
      "--props", propsPath,
      "--codec", "prores",
      "--prores-profile", "4444",
      "--frames", `0-${durationInFrames - 1}`,
      "--width", String(width),
      "--height", String(height),
      "--fps", String(fps),
      "--log", "error",
    ];

    await runNpx(args);
  } finally {
    release();
    // Clean up props file
    await unlink(propsPath).catch(() => {});
  }

  return outputPath;
}

/**
 * Composite a transparent overlay onto a base video using FFmpeg.
 *
 * @param {string} baseVideoPath - Path to base video (A-roll + B-roll)
 * @param {string} overlayPath - Path to ProRes 4444 overlay (.mov)
 * @param {string} outputPath - Path to final output
 * @param {Object} options - { audioNormalize }
 * @returns {Promise<string>} Path to composited output
 */
export async function compositeOverlay(baseVideoPath, overlayPath, outputPath, options = {}) {
  const { audioNormalize = true } = options;

  if (!baseVideoPath) throw new Error("baseVideoPath is required");
  if (!overlayPath) throw new Error("overlayPath is required");
  if (!outputPath) throw new Error("outputPath is required");

  await mkdir(dirname(outputPath), { recursive: true });

  // FFmpeg: overlay transparent ProRes on top of base video
  // -i base: video + audio
  // -i overlay: video with alpha (no audio)
  // overlay filter composites them
  let filterComplex = "[0:v][1:v]overlay=0:0:format=auto[outv]";

  if (audioNormalize) {
    filterComplex += ";[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[outa]";
  }

  const args = [
    "-y",
    "-i", baseVideoPath,
    "-i", overlayPath,
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-map", audioNormalize ? "[outa]" : "0:a",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];

  await runFFmpeg(args);
  return outputPath;
}

/**
 * Full overlay pipeline: render overlay + composite onto base video.
 *
 * @param {Object} params
 * @param {string} params.baseVideoPath - Base video path
 * @param {Array} params.captions - Caption entries
 * @param {Array} params.termFlashes - Term flash entries
 * @param {Array} params.chapterTitles - Chapter title entries (longform only)
 * @param {string} params.captionPreset - Caption color preset
 * @param {string} params.captionStyle - "short" | "longform"
 * @param {number} params.durationInSeconds - Video duration
 * @param {number} params.width - Video width
 * @param {number} params.height - Video height
 * @param {string} params.outputPath - Final output path
 * @param {string} params.compositionId - Remotion composition ID
 * @returns {Promise<Object>} { outputPath, overlayPath, stats }
 */
export async function renderAndComposite(params) {
  const {
    baseVideoPath,
    captions,
    termFlashes,
    chapterTitles,
    captionPreset,
    captionStyle,
    durationInSeconds,
    width = 1920,
    height = 1080,
    outputPath,
    compositionId = "CaptionOverlay",
  } = params;

  if (!baseVideoPath) throw new Error("baseVideoPath is required");
  if (!outputPath) throw new Error("outputPath is required");

  // Step 1: Render overlay as ProRes 4444
  const overlayPath = outputPath.replace(/\.[^.]+$/, "-overlay.mov");

  await renderOverlay({
    captions,
    termFlashes,
    chapterTitles,
    captionPreset,
    captionStyle,
    durationInSeconds,
    width,
    height,
    outputPath: overlayPath,
    compositionId,
  });

  // Step 2: Composite overlay onto base video
  await compositeOverlay(baseVideoPath, overlayPath, outputPath);

  // Step 3: Clean up overlay file
  await unlink(overlayPath).catch(() => {});

  return {
    outputPath,
    overlayPath,
    stats: {
      captionCount: captions ? captions.length : 0,
      termFlashCount: termFlashes ? termFlashes.length : 0,
      preset: captionPreset,
      style: captionStyle,
      durationInSeconds,
    },
  };
}

/**
 * Run an FFmpeg command and return a promise.
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
 * Run an npx command and return a promise.
 */
function runNpx(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`npx command failed (code ${code}): ${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}
