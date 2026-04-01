/**
 * FCP XML Exporter Module — Phase 6
 *
 * Generates xmeml (Final Cut Pro XML) from a pipeline manifest.
 * Compatible with DaVinci Resolve (free) and FCPX.
 *
 * Track mapping:
 *   V1 = A-roll (speaking head cuts)
 *   V2 = B-roll (overlay clips)
 *   V3 = Captions (Remotion ProRes overlay)
 *   V4 = Term Flashes (Remotion ProRes overlay)
 *
 * All timecodes are frame-accurate using integer frame math.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Default export settings.
 */
export const DEFAULTS = {
  fps: 30,
  ntsc: false,
  width: 1920,
  height: 1080,
};

/**
 * Convert seconds to frame count.
 *
 * @param {number} seconds - Time in seconds
 * @param {number} fps - Frames per second
 * @returns {number} Frame count (integer)
 */
export function secondsToFrames(seconds, fps = 30) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 0;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(seconds * fps);
}

/**
 * Escape XML special characters.
 *
 * @param {string} str - Raw string
 * @returns {string} XML-safe string
 */
export function escapeXml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert a file path to a file:// URL for xmeml.
 *
 * @param {string} filePath - Absolute or relative file path
 * @returns {string} file:// URL
 */
export function toFileUrl(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  const absolute = resolve(filePath);
  return `file://localhost${absolute}`;
}

/**
 * Generate a clipitem XML element.
 *
 * @param {Object} params
 * @param {string} params.id - Unique clip ID
 * @param {string} params.name - Clip display name
 * @param {string} params.fileId - File reference ID
 * @param {string} params.filePath - Path to media file
 * @param {number} params.start - Start frame on timeline
 * @param {number} params.end - End frame on timeline
 * @param {number} params.inPoint - In point within source (frames)
 * @param {number} params.outPoint - Out point within source (frames)
 * @param {number} params.fps - Frames per second
 * @param {number} params.width - Video width
 * @param {number} params.height - Video height
 * @returns {string} XML string
 */
export function generateClipitem(params) {
  const { id, name, fileId, filePath, start, end, inPoint, outPoint, fps, width, height } = params;

  return `          <clipitem id="${escapeXml(id)}">
            <name>${escapeXml(name)}</name>
            <duration>${end - start}</duration>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>${inPoint}</in>
            <out>${outPoint}</out>
            <file id="${escapeXml(fileId)}">
              <name>${escapeXml(name)}</name>
              <pathurl>${escapeXml(toFileUrl(filePath))}</pathurl>
              <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${width}</width>
                    <height>${height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>
          </clipitem>`;
}

/**
 * Generate a video track XML element.
 *
 * @param {Array} clipitems - Array of clipitem XML strings
 * @returns {string} XML string
 */
export function generateTrack(clipitems) {
  if (!Array.isArray(clipitems) || clipitems.length === 0) {
    return `        <track/>`;
  }
  return `        <track>\n${clipitems.join("\n")}\n        </track>`;
}

/**
 * Build V1 track (A-roll) from timeline segments.
 *
 * @param {Array} segments - [{start, end}] A-roll segments in seconds
 * @param {string} recordingPath - Path to source recording
 * @param {Object} options - { fps, width, height }
 * @returns {Array} Array of clipitem XML strings
 */
export function buildArollTrack(segments, recordingPath, options = {}) {
  const { fps = DEFAULTS.fps, width = DEFAULTS.width, height = DEFAULTS.height } = options;
  if (!Array.isArray(segments)) return [];

  const clips = [];
  let timelinePosition = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || typeof seg.start !== "number" || typeof seg.end !== "number") continue;

    const inFrame = secondsToFrames(seg.start, fps);
    const outFrame = secondsToFrames(seg.end, fps);
    const duration = outFrame - inFrame;

    clips.push(generateClipitem({
      id: `aroll-${i + 1}`,
      name: `A-roll ${i + 1}`,
      fileId: "source-recording",
      filePath: recordingPath,
      start: timelinePosition,
      end: timelinePosition + duration,
      inPoint: inFrame,
      outPoint: outFrame,
      fps,
      width,
      height,
    }));

    timelinePosition += duration;
  }

  return clips;
}

/**
 * Build V2 track (B-roll) from B-roll placements.
 *
 * @param {Array} placements - [{insertAt, duration, clipPath, ...}] B-roll placements
 * @param {Object} options - { fps, width, height }
 * @returns {Array} Array of clipitem XML strings
 */
export function buildBrollTrack(placements, options = {}) {
  const { fps = DEFAULTS.fps, width = DEFAULTS.width, height = DEFAULTS.height } = options;
  if (!Array.isArray(placements)) return [];

  const clips = [];

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (!p) continue;

    const startFrame = secondsToFrames(p.insertAt || p.start || 0, fps);
    const dur = p.duration || (p.end ? p.end - (p.insertAt || p.start || 0) : 0);
    const durationFrames = secondsToFrames(dur, fps);

    if (durationFrames <= 0) continue;

    clips.push(generateClipitem({
      id: `broll-${i + 1}`,
      name: `B-roll ${i + 1}`,
      fileId: `broll-file-${i + 1}`,
      filePath: p.clipPath || p.path || "",
      start: startFrame,
      end: startFrame + durationFrames,
      inPoint: 0,
      outPoint: durationFrames,
      fps,
      width,
      height,
    }));
  }

  return clips;
}

/**
 * Build V3 track (Captions) — references the Remotion ProRes overlay.
 *
 * @param {string} captionOverlayPath - Path to caption overlay .mov
 * @param {number} totalDuration - Total duration in seconds
 * @param {Object} options - { fps, width, height }
 * @returns {Array} Array of clipitem XML strings
 */
export function buildCaptionTrack(captionOverlayPath, totalDuration, options = {}) {
  const { fps = DEFAULTS.fps, width = DEFAULTS.width, height = DEFAULTS.height } = options;
  if (!captionOverlayPath || !totalDuration) return [];

  const totalFrames = secondsToFrames(totalDuration, fps);

  return [generateClipitem({
    id: "captions-overlay",
    name: "Captions Overlay",
    fileId: "captions-file",
    filePath: captionOverlayPath,
    start: 0,
    end: totalFrames,
    inPoint: 0,
    outPoint: totalFrames,
    fps,
    width,
    height,
  })];
}

/**
 * Build V4 track (Term Flashes) — references the Remotion ProRes overlay.
 *
 * @param {string} termFlashOverlayPath - Path to term flash overlay .mov
 * @param {number} totalDuration - Total duration in seconds
 * @param {Object} options - { fps, width, height }
 * @returns {Array} Array of clipitem XML strings
 */
export function buildTermFlashTrack(termFlashOverlayPath, totalDuration, options = {}) {
  const { fps = DEFAULTS.fps, width = DEFAULTS.width, height = DEFAULTS.height } = options;
  if (!termFlashOverlayPath || !totalDuration) return [];

  const totalFrames = secondsToFrames(totalDuration, fps);

  return [generateClipitem({
    id: "termflash-overlay",
    name: "Term Flash Overlay",
    fileId: "termflash-file",
    filePath: termFlashOverlayPath,
    start: 0,
    end: totalFrames,
    inPoint: 0,
    outPoint: totalFrames,
    fps,
    width,
    height,
  })];
}

/**
 * Generate a complete xmeml document.
 *
 * @param {Object} params
 * @param {string} params.name - Sequence/project name
 * @param {number} params.totalDuration - Total duration in seconds
 * @param {Array} params.arollSegments - A-roll segments [{start, end}]
 * @param {string} params.recordingPath - Path to source recording
 * @param {Array} params.brollPlacements - B-roll placements
 * @param {string} params.captionOverlayPath - Path to caption overlay
 * @param {string} params.termFlashOverlayPath - Path to term flash overlay
 * @param {Object} params.options - { fps, width, height }
 * @returns {string} Complete xmeml XML string
 */
export function generateXmeml(params) {
  const {
    name = "Timeline Export",
    totalDuration = 0,
    arollSegments = [],
    recordingPath = "",
    brollPlacements = [],
    captionOverlayPath = "",
    termFlashOverlayPath = "",
    options = {},
  } = params || {};

  const fps = options.fps || DEFAULTS.fps;
  const width = options.width || DEFAULTS.width;
  const height = options.height || DEFAULTS.height;
  const totalFrames = secondsToFrames(totalDuration, fps);
  const trackOpts = { fps, width, height };

  const v1Clips = buildArollTrack(arollSegments, recordingPath, trackOpts);
  const v2Clips = buildBrollTrack(brollPlacements, trackOpts);
  const v3Clips = buildCaptionTrack(captionOverlayPath, totalDuration, trackOpts);
  const v4Clips = buildTermFlashTrack(termFlashOverlayPath, totalDuration, trackOpts);

  const v1Track = generateTrack(v1Clips);
  const v2Track = generateTrack(v2Clips);
  const v3Track = generateTrack(v3Clips);
  const v4Track = generateTrack(v4Clips);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(name)}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${width}</width>
            <height>${height}</height>
          </samplecharacteristics>
        </format>
${v1Track}
${v2Track}
${v3Track}
${v4Track}
      </video>
      <audio>
        <track>
          <clipitem id="audio-main">
            <name>Audio</name>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Export a manifest as FCP XML (xmeml) to a file.
 *
 * @param {Object} params - Same as generateXmeml params
 * @param {string} outputPath - Path to write the XML file
 * @returns {Promise<string>} Path to written file
 */
export async function exportFcpXml(params, outputPath) {
  if (!outputPath || typeof outputPath !== "string") {
    throw new Error("outputPath is required");
  }

  const xml = generateXmeml(params);
  await writeFile(outputPath, xml, "utf-8");
  return outputPath;
}
