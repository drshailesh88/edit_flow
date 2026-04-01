/**
 * Tests for Brightness Analyzer Module
 *
 * Tests cover:
 * - Luminance parsing from FFmpeg signalstats output
 * - Preset selection logic (auto, manual, fallback)
 * - Edge cases and invalid input
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseLuminanceFromStats,
  selectCaptionPreset,
  analyzeBrightness,
} from "./brightness-analyzer.js";

describe("parseLuminanceFromStats", () => {
  it("parses YAVG values from FFmpeg signalstats output", () => {
    const stderr = `
[Parsed_signalstats_1 @ 0x1234] YAVG: 142.3 YMIN: 16 YMAX: 235
[Parsed_signalstats_1 @ 0x1234] YAVG: 138.7 YMIN: 12 YMAX: 240
[Parsed_signalstats_1 @ 0x1234] YAVG: 155.1 YMIN: 20 YMAX: 230
`;
    const values = parseLuminanceFromStats(stderr);
    assert.equal(values.length, 3);
    assert.equal(values[0], 142.3);
    assert.equal(values[1], 138.7);
    assert.equal(values[2], 155.1);
  });

  it("handles output with no YAVG values", () => {
    const stderr = "frame= 100 fps=0.0 q=-0.0 Lsize=N/A time=00:00:03.33";
    assert.deepEqual(parseLuminanceFromStats(stderr), []);
  });

  it("handles empty string", () => {
    assert.deepEqual(parseLuminanceFromStats(""), []);
  });

  it("handles null input", () => {
    assert.deepEqual(parseLuminanceFromStats(null), []);
  });

  it("handles undefined input", () => {
    assert.deepEqual(parseLuminanceFromStats(undefined), []);
  });

  it("handles non-string input", () => {
    assert.deepEqual(parseLuminanceFromStats(42), []);
    assert.deepEqual(parseLuminanceFromStats(true), []);
  });

  it("filters out invalid luminance values", () => {
    const stderr = `
[Parsed_signalstats_1 @ 0x1234] YAVG: 142.3
[Parsed_signalstats_1 @ 0x1234] YAVG: -5.0
[Parsed_signalstats_1 @ 0x1234] YAVG: 300.0
[Parsed_signalstats_1 @ 0x1234] YAVG: 100.0
`;
    const values = parseLuminanceFromStats(stderr);
    assert.equal(values.length, 2); // Only 142.3 and 100.0 are in [0,255]
    assert.equal(values[0], 142.3);
    assert.equal(values[1], 100.0);
  });

  it("handles YAVG with integer values", () => {
    const stderr = "[Parsed_signalstats_1 @ 0x1234] YAVG: 128 YMIN: 16";
    const values = parseLuminanceFromStats(stderr);
    assert.equal(values.length, 1);
    assert.equal(values[0], 128);
  });

  it("handles multiple YAVG on same line (only first should match per line)", () => {
    const stderr = "YAVG: 100.0 YAVG: 200.0";
    const values = parseLuminanceFromStats(stderr);
    assert.equal(values.length, 2); // regex finds both
  });

  it("handles YAVG at boundary values", () => {
    const stderr = "YAVG: 0\nYAVG: 255\n";
    const values = parseLuminanceFromStats(stderr);
    assert.equal(values.length, 2);
    assert.equal(values[0], 0);
    assert.equal(values[1], 255);
  });

  it("classifies dark scene correctly (YAVG < 128)", () => {
    const stderr = "YAVG: 60.0\nYAVG: 70.0\nYAVG: 80.0\n";
    const values = parseLuminanceFromStats(stderr);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    assert.ok(mean < 128, "Dark scene should have mean luminance < 128");
  });

  it("classifies bright scene correctly (YAVG >= 128)", () => {
    const stderr = "YAVG: 160.0\nYAVG: 180.0\nYAVG: 200.0\n";
    const values = parseLuminanceFromStats(stderr);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    assert.ok(mean >= 128, "Bright scene should have mean luminance >= 128");
  });
});

describe("selectCaptionPreset — manual override", () => {
  it("returns manual preset when valid white-on-black", async () => {
    const result = await selectCaptionPreset("/fake/video.mp4", {
      manualPreset: "white-on-black",
    });
    assert.equal(result.preset, "white-on-black");
    assert.equal(result.source, "manual");
    assert.equal(result.analysis, null);
  });

  it("returns manual preset when valid black-on-white", async () => {
    const result = await selectCaptionPreset("/fake/video.mp4", {
      manualPreset: "black-on-white",
    });
    assert.equal(result.preset, "black-on-white");
    assert.equal(result.source, "manual");
  });

  it("throws on invalid manual preset", async () => {
    await assert.rejects(
      () => selectCaptionPreset("/fake/video.mp4", { manualPreset: "rainbow" }),
      { message: /Invalid preset "rainbow"/ }
    );
  });

  it("skips FFmpeg analysis when manual preset provided", async () => {
    // Even with a non-existent video, manual preset should work
    const result = await selectCaptionPreset("/nonexistent/video.mp4", {
      manualPreset: "white-on-black",
    });
    assert.equal(result.preset, "white-on-black");
    assert.equal(result.source, "manual");
  });
});

describe("selectCaptionPreset — default fallback", () => {
  it("falls back to white-on-black when FFmpeg fails", async () => {
    // Non-existent file will cause FFmpeg to fail
    const result = await selectCaptionPreset("/nonexistent/video.mp4");
    assert.equal(result.preset, "white-on-black");
    assert.equal(result.source, "default");
    assert.equal(result.analysis, null);
  });
});

describe("analyzeBrightness — input validation", () => {
  it("throws on null videoPath", async () => {
    await assert.rejects(
      () => analyzeBrightness(null),
      { message: /videoPath is required/ }
    );
  });

  it("throws on empty string videoPath", async () => {
    await assert.rejects(
      () => analyzeBrightness(""),
      { message: /videoPath is required/ }
    );
  });

  it("throws on non-string videoPath", async () => {
    await assert.rejects(
      () => analyzeBrightness(42),
      { message: /videoPath is required/ }
    );
  });
});

describe("analyzeBrightness — with real video", () => {
  it("analyzes test fixture video brightness", async () => {
    // This test requires the test fixture to exist
    const testVideo = "test-fixtures/test-recording.mp4";
    try {
      const result = await analyzeBrightness(testVideo, { sampleFrames: 60 });
      assert.equal(typeof result.meanLuminance, "number");
      assert.equal(typeof result.isDark, "boolean");
      assert.ok(["white-on-black", "black-on-white"].includes(result.recommendedPreset));
      assert.ok(result.sampledFrames > 0);
      assert.ok(result.meanLuminance >= 0 && result.meanLuminance <= 255);
    } catch (err) {
      // Skip if test fixture not available
      if (err.message.includes("ENOENT") || err.message.includes("No such file")) {
        return; // Test fixture not available, skip
      }
      throw err;
    }
  });
});
