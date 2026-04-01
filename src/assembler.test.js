/**
 * Tests for the Assembler module
 *
 * Tests FFmpeg assembly of speaking segments into a final MP4.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleFromSegments, getVideoDuration } from "./assembler.js";
import { detectSilence, getSpeakingSegments, getMediaInfo } from "./ingest.js";
import { existsSync } from "node:fs";
import { unlink, mkdir } from "node:fs/promises";

const TEST_RECORDING = "test-fixtures/test-recording.mp4";
const TEST_OUTPUT = "test-fixtures/test-output.mp4";

describe("Assembler — assembleFromSegments", () => {
  it("should assemble speaking segments into an output MP4", async () => {
    // Get real speaking segments from test recording
    const silences = await detectSilence(TEST_RECORDING);
    const info = await getMediaInfo(TEST_RECORDING);
    const segments = getSpeakingSegments(silences, info.duration);

    assert.ok(segments.length > 0, "should have segments to assemble");

    // Clean up previous test output
    await unlink(TEST_OUTPUT).catch(() => {});

    // Assemble
    await assembleFromSegments(TEST_RECORDING, segments, TEST_OUTPUT, {
      audioNormalize: false, // skip normalization for speed in tests
    });

    // Verify output exists
    assert.ok(existsSync(TEST_OUTPUT), "output file should exist");

    // Verify output duration
    const outputDuration = await getVideoDuration(TEST_OUTPUT);
    const expectedDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);

    // Allow 2 second tolerance for encoding differences
    assert.ok(
      Math.abs(outputDuration - expectedDuration) < 2,
      `output duration (${outputDuration.toFixed(1)}s) should be close to expected (${expectedDuration.toFixed(1)}s)`
    );

    // Output should be shorter than input (silence removed)
    assert.ok(outputDuration < info.duration,
      `output (${outputDuration.toFixed(1)}s) should be shorter than input (${info.duration.toFixed(1)}s)`);

    // Clean up
    await unlink(TEST_OUTPUT).catch(() => {});
  });

  it("should throw on empty segments", async () => {
    await assert.rejects(
      () => assembleFromSegments(TEST_RECORDING, [], TEST_OUTPUT),
      /No speaking segments/
    );
  });
});

describe("Assembler — getVideoDuration", () => {
  it("should return duration of test recording", async () => {
    const dur = await getVideoDuration(TEST_RECORDING);
    assert.ok(dur > 0, "duration should be positive");
    assert.ok(dur > 100, "test recording should be about 120 seconds");
    assert.ok(dur < 140, "test recording should be about 120 seconds");
  });
});
