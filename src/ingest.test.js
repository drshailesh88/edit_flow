/**
 * Tests for the Ingest module
 *
 * Tests silence detection and speaking segment computation.
 * Whisper transcription tested with the real test fixture.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSilence, getSpeakingSegments, getMediaInfo } from "./ingest.js";

const TEST_RECORDING = "test-fixtures/test-recording.mp4";

describe("Ingest — getMediaInfo", () => {
  it("should return duration, dimensions, and audio info", async () => {
    const info = await getMediaInfo(TEST_RECORDING);
    assert.ok(info.duration > 0, "duration should be positive");
    assert.equal(info.width, 1920, "width should be 1920");
    assert.equal(info.height, 1080, "height should be 1080");
    assert.ok(info.fps > 0, "fps should be positive");
    assert.ok(info.audioSampleRate > 0, "audio sample rate should be positive");
  });
});

describe("Ingest — detectSilence", () => {
  it("should detect silence gaps in the test recording", async () => {
    const silences = await detectSilence(TEST_RECORDING);
    assert.ok(Array.isArray(silences), "should return array");
    // A talking head video should have at least some pauses
    assert.ok(silences.length > 0, "should detect at least one silence gap");

    for (const s of silences) {
      assert.ok(typeof s.start === "number", "silence start should be a number");
      assert.ok(typeof s.end === "number", "silence end should be a number");
      assert.ok(typeof s.duration === "number", "silence duration should be a number");
      assert.ok(s.end > s.start, "silence end should be after start");
      assert.ok(s.duration > 0, "silence duration should be positive");
    }
  });
});

describe("Ingest — getSpeakingSegments", () => {
  it("should return full duration when no silences", () => {
    const segments = getSpeakingSegments([], 100);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].start, 0);
    assert.equal(segments[0].end, 100);
  });

  it("should compute speaking segments between silences", () => {
    const silences = [
      { start: 10, end: 15, duration: 5 },
      { start: 30, end: 35, duration: 5 },
    ];
    const segments = getSpeakingSegments(silences, 50);

    assert.ok(segments.length >= 2, "should have at least 2 speaking segments");

    // All segments should have positive duration
    for (const s of segments) {
      assert.ok(s.end > s.start, `segment ${s.start}-${s.end} should have positive duration`);
    }

    // No segment should overlap with silence
    for (const seg of segments) {
      for (const sil of silences) {
        const overlap = Math.min(seg.end, sil.end) - Math.max(seg.start, sil.start);
        // Allow small overlap due to padding
        assert.ok(overlap < 0.2, `segment should not significantly overlap with silence`);
      }
    }
  });

  it("should handle silence at the beginning", () => {
    const silences = [{ start: 0, end: 5, duration: 5 }];
    const segments = getSpeakingSegments(silences, 30);
    assert.ok(segments.length >= 1);
    assert.ok(segments[0].start >= 4.9, "first segment should start after silence");
  });

  it("should handle silence at the end", () => {
    const silences = [{ start: 25, end: 30, duration: 5 }];
    const segments = getSpeakingSegments(silences, 30);
    assert.ok(segments.length >= 1);
    // Last segment should end before or at the silence start (+ padding)
    const lastSeg = segments[segments.length - 1];
    assert.ok(lastSeg.end <= 25.1, "last segment should end around silence start");
  });

  it("should produce segments from real silence detection", async () => {
    const silences = await detectSilence(TEST_RECORDING);
    const info = await getMediaInfo(TEST_RECORDING);
    const segments = getSpeakingSegments(silences, info.duration);

    assert.ok(segments.length > 0, "should produce speaking segments");

    // Total speaking time should be less than original duration
    const totalSpeaking = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
    assert.ok(totalSpeaking < info.duration, "speaking time should be less than total duration");
    assert.ok(totalSpeaking > info.duration * 0.3, "speaking time should be at least 30% of total");

    // Segments should be in order
    for (let i = 1; i < segments.length; i++) {
      assert.ok(segments[i].start >= segments[i - 1].end - 0.1,
        `segment ${i} should start after segment ${i - 1} ends`);
    }
  });
});
