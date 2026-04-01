/**
 * Tests for the Auto-Reframe module
 *
 * Validates face detection integration, crop computation,
 * and FFmpeg reframe pipeline.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectFace, computeCropParams, autoReframe } from "./auto-reframe.js";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { unlink, mkdir } from "node:fs/promises";

const TEST_FIXTURE = "test-fixtures/test-recording.mp4";
const fixtureExists = existsSync(TEST_FIXTURE);

describe("Auto-Reframe — computeCropParams", () => {
  it("should compute 9:16 crop from 1920x1080 with centered face", () => {
    const faceResult = {
      face_detected: true,
      center_x: 960,  // center of frame
      center_y: 540,
      frame_width: 1920,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);

    // 9:16 from 1080 height = 1080 * 9/16 = 607.5 ≈ 608
    assert.equal(crop.cropHeight, 1080);
    assert.equal(crop.cropWidth, 608);  // round(1080 * 9/16)
    assert.equal(crop.cropY, 0);
    // Centered on 960: 960 - 304 = 656
    assert.equal(crop.cropX, 656);
  });

  it("should clamp crop to left edge when face is near left", () => {
    const faceResult = {
      face_detected: true,
      center_x: 100,  // near left edge
      center_y: 540,
      frame_width: 1920,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);

    // 100 - 304 = -204, clamped to 0
    assert.equal(crop.cropX, 0);
  });

  it("should clamp crop to right edge when face is near right", () => {
    const faceResult = {
      face_detected: true,
      center_x: 1900,  // near right edge
      center_y: 540,
      frame_width: 1920,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);

    // 1920 - 608 = 1312 (max X)
    assert.equal(crop.cropX, 1312);
  });

  it("should handle non-standard resolutions", () => {
    const faceResult = {
      face_detected: false,
      center_x: 640,  // center fallback
      center_y: 360,
      frame_width: 1280,
      frame_height: 720,
    };

    const crop = computeCropParams(faceResult);

    assert.equal(crop.cropHeight, 720);
    assert.equal(crop.cropWidth, Math.round(720 * 9 / 16));  // 405
    assert.ok(crop.cropX >= 0);
    assert.ok(crop.cropX + crop.cropWidth <= 1280);
  });

  it("should throw on null input", () => {
    assert.throws(() => computeCropParams(null), /No face detection result/);
  });

  it("should throw on missing frame dimensions", () => {
    assert.throws(
      () => computeCropParams({ face_detected: true, center_x: 500, center_y: 300 }),
      /Missing frame dimensions/
    );
  });

  it("should use full frame height (no vertical crop)", () => {
    const faceResult = {
      face_detected: true,
      center_x: 960,
      center_y: 100,  // face near top — should NOT affect vertical crop
      frame_width: 1920,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);
    assert.equal(crop.cropHeight, 1080);
    assert.equal(crop.cropY, 0);
  });
});

describe("Auto-Reframe — detectFace (real video)", () => {
  it("should detect face position in test recording", { skip: !fixtureExists && "test fixture not available" }, async () => {
    const result = await detectFace(TEST_FIXTURE, { samples: 5 });

    assert.ok(typeof result.center_x === "number");
    assert.ok(typeof result.center_y === "number");
    assert.ok(result.frame_width > 0);
    assert.ok(result.frame_height > 0);
    assert.ok(result.samples === 5);
  });
});

describe("Auto-Reframe — autoReframe (real video)", () => {
  const outputPath = "output/test-reframe-vertical.mp4";

  it("should produce a 9:16 vertical video", { skip: !fixtureExists && "test fixture not available" }, async () => {
    await mkdir("output", { recursive: true });

    const result = await autoReframe(TEST_FIXTURE, outputPath, { samples: 5 });

    assert.ok(existsSync(outputPath));
    assert.ok(result.cropParams.cropWidth > 0);
    assert.ok(result.cropParams.cropHeight > 0);
    assert.equal(result.outputPath, outputPath);

    // Verify output is 9:16 using ffprobe
    const { getMediaInfo } = await import("./ingest.js");
    const info = await getMediaInfo(outputPath);

    // Width should be ~608 (9:16 of 1080)
    assert.ok(info.width < info.height, `Expected vertical video, got ${info.width}x${info.height}`);
    // Aspect ratio should be approximately 9:16
    const ratio = info.width / info.height;
    assert.ok(ratio > 0.5 && ratio < 0.6, `Expected 9:16 ratio (~0.5625), got ${ratio.toFixed(4)}`);

    // Cleanup
    await unlink(outputPath).catch(() => {});
  });

  it("should produce correct output with pre-computed face result", { skip: !fixtureExists && "test fixture not available" }, async () => {
    await mkdir("output", { recursive: true });

    // Provide face result directly (skip detection)
    const faceResult = {
      face_detected: true,
      center_x: 960,
      center_y: 540,
      frame_width: 1920,
      frame_height: 1080,
    };

    const result = await autoReframe(TEST_FIXTURE, outputPath, { faceResult });

    assert.ok(existsSync(outputPath));
    assert.equal(result.faceResult.center_x, 960);

    // Cleanup
    await unlink(outputPath).catch(() => {});
  });
});

describe("Auto-Reframe — adversarial: edge cases", () => {
  it("should handle square video (1:1)", () => {
    const faceResult = {
      face_detected: true,
      center_x: 500,
      center_y: 500,
      frame_width: 1000,
      frame_height: 1000,
    };

    const crop = computeCropParams(faceResult);
    assert.equal(crop.cropHeight, 1000);
    assert.equal(crop.cropWidth, Math.round(1000 * 9 / 16));
    assert.ok(crop.cropX >= 0);
  });

  it("should handle already-vertical video (9:16)", () => {
    const faceResult = {
      face_detected: true,
      center_x: 304,
      center_y: 540,
      frame_width: 608,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);
    assert.equal(crop.cropHeight, 1080);
    // cropWidth = 1080 * 9/16 = 608 — same as frame width
    assert.equal(crop.cropWidth, 608);
    assert.equal(crop.cropX, 0);
  });

  it("should handle null options in detectFace", async () => {
    // detectFace should default options without crashing
    // We can't actually call it without a video, but test the parameter handling
    try {
      await detectFace("/nonexistent/video.mp4", null);
    } catch (e) {
      // Expected to fail on file not found, not on null options
      assert.ok(e.message.includes("Cannot open") || e.message.includes("failed"),
        `Unexpected error: ${e.message}`);
    }
  });

  it("should handle null options in autoReframe", async () => {
    try {
      await autoReframe("/nonexistent/video.mp4", "/tmp/out.mp4", null);
    } catch (e) {
      assert.ok(e.message.includes("Cannot open") || e.message.includes("failed"),
        `Unexpected error: ${e.message}`);
    }
  });
});
