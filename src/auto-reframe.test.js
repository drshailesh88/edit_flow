/**
 * Tests for the Auto-Reframe module
 *
 * Validates face detection integration, crop computation,
 * and FFmpeg reframe pipeline.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectFace, computeCropParams, autoReframe } from "./auto-reframe.js";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { unlink, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

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
      /frame dimensions/i
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

  it("should not return a crop wider than the source frame", () => {
    const faceResult = {
      face_detected: true,
      center_x: 150,
      center_y: 540,
      frame_width: 300,
      frame_height: 1080,
    };

    const crop = computeCropParams(faceResult);
    assert.ok(
      crop.cropWidth <= faceResult.frame_width,
      `Expected cropWidth <= ${faceResult.frame_width}, got ${crop.cropWidth}`
    );
  });

  it("should reject non-positive frame dimensions", () => {
    assert.throws(
      () => computeCropParams({
        face_detected: true,
        center_x: 960,
        center_y: 540,
        frame_width: -1920,
        frame_height: 1080,
      }),
      /frame/i
    );

    assert.throws(
      () => computeCropParams({
        face_detected: true,
        center_x: 960,
        center_y: 540,
        frame_width: 1920,
        frame_height: -1080,
      }),
      /frame/i
    );
  });

  it("should not produce NaN crop coordinates when center_x is missing", () => {
    const crop = computeCropParams({
      face_detected: true,
      center_y: 540,
      frame_width: 1920,
      frame_height: 1080,
    });

    assert.ok(Number.isFinite(crop.cropX), `Expected finite cropX, got ${crop.cropX}`);
  });

  it("python script should not crash when --samples is zero", async () => {
    const fakeCv2Dir = await mkdtemp(join(tmpdir(), "fake-cv2-"));
    const scriptPath = join(
      decodeURIComponent(dirname(new URL(import.meta.url).pathname)),
      "..",
      "scripts",
      "detect-face.py"
    );

    const fakeCv2 = `CAP_PROP_FRAME_COUNT = 7
CAP_PROP_FRAME_WIDTH = 3
CAP_PROP_FRAME_HEIGHT = 4
CAP_PROP_POS_FRAMES = 1
COLOR_BGR2GRAY = 6
__file__ = __file__

class VideoCapture:
    def __init__(self, path):
        self.path = path
    def isOpened(self):
        return True
    def get(self, prop):
        if prop == CAP_PROP_FRAME_COUNT:
            return 10
        if prop == CAP_PROP_FRAME_WIDTH:
            return 1920
        if prop == CAP_PROP_FRAME_HEIGHT:
            return 1080
        return 0
    def set(self, prop, value):
        return True
    def read(self):
        return True, "frame"
    def release(self):
        return True

def cvtColor(frame, code):
    return frame

class CascadeClassifier:
    def __init__(self, path):
        self.path = path
    def detectMultiScale(self, gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50)):
        return []
`;

    await mkdir(join(fakeCv2Dir, "data"), { recursive: true });
    await writeFile(join(fakeCv2Dir, "cv2.py"), fakeCv2);
    await writeFile(join(fakeCv2Dir, "data", "haarcascade_frontalface_default.xml"), "");

    try {
      const result = spawnSync(
        "python3",
        [scriptPath, "/tmp/fake-video.mp4", "--samples", "0"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PYTHONPATH: fakeCv2Dir,
          },
        }
      );

      assert.equal(
        result.status,
        0,
        `Expected zero exit status, got ${result.status}: ${result.stderr}`
      );
    } finally {
      await rm(fakeCv2Dir, { recursive: true, force: true });
    }
  });
});
