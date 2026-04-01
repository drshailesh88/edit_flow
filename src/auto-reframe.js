/**
 * Auto-Reframe Module — Phase 2
 *
 * Converts 16:9 horizontal video to 9:16 vertical format for Shorts.
 * Uses face detection to center the crop on the creator's face.
 *
 * Strategy:
 * 1. Detect face position via OpenCV (Python script)
 * 2. Compute 9:16 crop rectangle centered on face
 * 3. Apply FFmpeg crop filter
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";

/**
 * Detect face position in a video using OpenCV Haar cascade.
 * Returns the average face center across sampled frames.
 *
 * @param {string} videoPath - Path to the source video
 * @param {Object} options - { samples: number of frames to sample }
 * @returns {Object} { face_detected, center_x, center_y, frame_width, frame_height, ... }
 */
export async function detectFace(videoPath, options) {
  const { samples = 10 } = options || {};
  const scriptPath = join(
    decodeURIComponent(dirname(new URL(import.meta.url).pathname)),
    "..",
    "scripts",
    "detect-face.py"
  );

  const args = [scriptPath, videoPath, "--samples", String(samples)];

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data; });
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Face detection failed (code ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse face detection output: ${e.message}`));
      }
    });
  });
}

/**
 * Compute 9:16 crop parameters from face detection result.
 *
 * Given a 16:9 frame and a face center position, compute the crop
 * rectangle that produces a 9:16 vertical frame centered on the face.
 *
 * The crop height = source frame height (use full height).
 * The crop width = height * 9/16 (9:16 aspect ratio).
 * The crop is horizontally centered on the face.
 *
 * @param {Object} faceResult - from detectFace()
 * @returns {Object} { cropWidth, cropHeight, cropX, cropY }
 */
export function computeCropParams(faceResult) {
  if (!faceResult) {
    throw new Error("No face detection result provided");
  }

  const frameWidth = faceResult.frame_width;
  const frameHeight = faceResult.frame_height;

  if (!frameWidth || !frameHeight) {
    throw new Error("Missing frame dimensions in face detection result");
  }

  // 9:16 aspect ratio: width = height * 9/16
  const cropHeight = frameHeight;
  const cropWidth = Math.round(cropHeight * 9 / 16);

  // Center crop horizontally on face
  const faceCenterX = faceResult.center_x;
  let cropX = faceCenterX - Math.round(cropWidth / 2);

  // Clamp to frame bounds
  cropX = Math.max(0, Math.min(cropX, frameWidth - cropWidth));

  // Crop starts at top of frame (full height)
  const cropY = 0;

  return { cropWidth, cropHeight, cropX, cropY };
}

/**
 * Auto-reframe a video from 16:9 to 9:16 using face-centered crop.
 *
 * @param {string} inputPath - Source 16:9 video
 * @param {string} outputPath - Destination 9:16 video
 * @param {Object} options - { samples, faceResult }
 * @returns {Object} { outputPath, cropParams, faceResult }
 */
export async function autoReframe(inputPath, outputPath, options) {
  const { samples = 10, faceResult: providedFaceResult } = options || {};

  // Step 1: Detect face (or use provided result)
  const faceResult = providedFaceResult || await detectFace(inputPath, { samples });

  // Step 2: Compute crop parameters
  const cropParams = computeCropParams(faceResult);

  // Step 3: Apply FFmpeg crop
  const { cropWidth, cropHeight, cropX, cropY } = cropParams;
  const cropFilter = `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`;

  const args = [
    "-y",
    "-i", inputPath,
    "-vf", cropFilter,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];

  await runFFmpeg(args);

  return { outputPath, cropParams, faceResult };
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
