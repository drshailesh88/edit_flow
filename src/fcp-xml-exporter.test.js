/**
 * Tests for FCP XML Exporter Module — Phase 6
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  secondsToFrames,
  escapeXml,
  toFileUrl,
  generateClipitem,
  generateTrack,
  buildArollTrack,
  buildBrollTrack,
  buildCaptionTrack,
  buildTermFlashTrack,
  generateXmeml,
  exportFcpXml,
  DEFAULTS,
} from "./fcp-xml-exporter.js";

describe("DEFAULTS", () => {
  it("has expected default values", () => {
    assert.equal(DEFAULTS.fps, 30);
    assert.equal(DEFAULTS.ntsc, false);
    assert.equal(DEFAULTS.width, 1920);
    assert.equal(DEFAULTS.height, 1080);
  });
});

describe("secondsToFrames", () => {
  it("converts seconds to frames at 30fps", () => {
    assert.equal(secondsToFrames(1, 30), 30);
    assert.equal(secondsToFrames(0.5, 30), 15);
    assert.equal(secondsToFrames(10, 30), 300);
  });

  it("converts seconds to frames at 24fps", () => {
    assert.equal(secondsToFrames(1, 24), 24);
    assert.equal(secondsToFrames(2.5, 24), 60);
  });

  it("rounds to nearest frame", () => {
    assert.equal(secondsToFrames(1.0167, 30), 31); // 30.5 rounds to 31
  });

  it("returns 0 for invalid input", () => {
    assert.equal(secondsToFrames(NaN, 30), 0);
    assert.equal(secondsToFrames(null, 30), 0);
    assert.equal(secondsToFrames(undefined, 30), 0);
    assert.equal(secondsToFrames(Infinity, 30), 0);
    assert.equal(secondsToFrames(5, 0), 0);
    assert.equal(secondsToFrames(5, -1), 0);
    assert.equal(secondsToFrames(5, NaN), 0);
  });

  it("defaults to 30fps", () => {
    assert.equal(secondsToFrames(1), 30);
  });
});

describe("escapeXml", () => {
  it("escapes all special XML characters", () => {
    assert.equal(escapeXml('&<>"\''), "&amp;&lt;&gt;&quot;&apos;");
  });

  it("passes through normal strings", () => {
    assert.equal(escapeXml("hello world"), "hello world");
  });

  it("handles non-string input", () => {
    assert.equal(escapeXml(null), "");
    assert.equal(escapeXml(undefined), "");
    assert.equal(escapeXml(123), "");
  });
});

describe("toFileUrl", () => {
  it("converts absolute path to file URL", () => {
    const result = toFileUrl("/Users/test/video.mp4");
    assert.ok(result.startsWith("file:///"), `Expected file:/// prefix, got ${result}`);
    assert.ok(result.endsWith("video.mp4"));
  });

  it("handles empty input", () => {
    assert.equal(toFileUrl(""), "");
    assert.equal(toFileUrl(null), "");
  });
});

describe("generateClipitem", () => {
  it("produces valid XML with all fields", () => {
    const xml = generateClipitem({
      id: "clip-1",
      name: "Test Clip",
      fileId: "file-1",
      filePath: "/test/video.mp4",
      start: 0,
      end: 300,
      inPoint: 0,
      outPoint: 300,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    assert.ok(xml.includes('id="clip-1"'));
    assert.ok(xml.includes("<name>Test Clip</name>"));
    assert.ok(xml.includes("<duration>300</duration>"));
    assert.ok(xml.includes("<start>0</start>"));
    assert.ok(xml.includes("<end>300</end>"));
    assert.ok(xml.includes("<in>0</in>"));
    assert.ok(xml.includes("<out>300</out>"));
    assert.ok(xml.includes("<timebase>30</timebase>"));
    assert.ok(xml.includes("<width>1920</width>"));
    assert.ok(xml.includes("<height>1080</height>"));
    assert.ok(xml.includes("file:///"));
  });

  it("escapes special characters in names", () => {
    const xml = generateClipitem({
      id: "clip-1",
      name: 'Test & "Clip"',
      fileId: "file-1",
      filePath: "/test/video.mp4",
      start: 0,
      end: 30,
      inPoint: 0,
      outPoint: 30,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    assert.ok(xml.includes("Test &amp; &quot;Clip&quot;"));
  });
});

describe("generateTrack", () => {
  it("wraps clipitems in track element", () => {
    const xml = generateTrack(["<clipitem>test</clipitem>"]);
    assert.ok(xml.includes("<track>"));
    assert.ok(xml.includes("<clipitem>test</clipitem>"));
    assert.ok(xml.includes("</track>"));
  });

  it("produces self-closing track for empty array", () => {
    assert.equal(generateTrack([]), "        <track/>");
  });

  it("produces self-closing track for null", () => {
    assert.equal(generateTrack(null), "        <track/>");
  });
});

describe("buildArollTrack", () => {
  it("creates clipitems from segments", () => {
    const segments = [
      { start: 0, end: 10 },
      { start: 15, end: 25 },
    ];

    const clips = buildArollTrack(segments, "/test/recording.mp4");
    assert.equal(clips.length, 2);
    assert.ok(clips[0].includes('id="aroll-1"'));
    assert.ok(clips[1].includes('id="aroll-2"'));
  });

  it("computes correct timeline positions (sequential)", () => {
    const segments = [
      { start: 5, end: 10 },   // 5s = 150 frames
      { start: 20, end: 25 },  // 5s = 150 frames
    ];

    const clips = buildArollTrack(segments, "/test/rec.mp4", { fps: 30 });
    // First clip: timeline 0-150
    assert.ok(clips[0].includes("<start>0</start>"));
    assert.ok(clips[0].includes("<end>150</end>"));
    // Second clip: timeline 150-300
    assert.ok(clips[1].includes("<start>150</start>"));
    assert.ok(clips[1].includes("<end>300</end>"));
  });

  it("uses source timecodes for in/out points", () => {
    const segments = [{ start: 5, end: 10 }];
    const clips = buildArollTrack(segments, "/test/rec.mp4", { fps: 30 });
    assert.ok(clips[0].includes("<in>150</in>"));   // 5s * 30fps
    assert.ok(clips[0].includes("<out>300</out>")); // 10s * 30fps
  });

  it("skips invalid segments", () => {
    const segments = [
      { start: 0, end: 5 },
      null,
      { start: "bad", end: 10 },
      { start: 10, end: 15 },
    ];
    const clips = buildArollTrack(segments, "/test/rec.mp4");
    assert.equal(clips.length, 2);
  });

  it("returns empty for null input", () => {
    assert.deepEqual(buildArollTrack(null, "/test/rec.mp4"), []);
  });
});

describe("buildBrollTrack", () => {
  it("creates clipitems from placements", () => {
    const placements = [
      { insertAt: 10, duration: 3, clipPath: "/broll/clip1.mp4" },
      { insertAt: 25, duration: 4, clipPath: "/broll/clip2.mp4" },
    ];

    const clips = buildBrollTrack(placements);
    assert.equal(clips.length, 2);
    assert.ok(clips[0].includes('id="broll-1"'));
    assert.ok(clips[1].includes('id="broll-2"'));
  });

  it("handles start/end format", () => {
    const placements = [
      { start: 5, end: 8, path: "/broll/clip.mp4" },
    ];
    const clips = buildBrollTrack(placements);
    assert.equal(clips.length, 1);
    assert.ok(clips[0].includes("<start>150</start>")); // 5s * 30fps
  });

  it("skips zero-duration placements", () => {
    const placements = [
      { insertAt: 10, duration: 0, clipPath: "/broll/clip.mp4" },
    ];
    assert.equal(buildBrollTrack(placements).length, 0);
  });

  it("returns empty for null", () => {
    assert.deepEqual(buildBrollTrack(null), []);
  });
});

describe("buildCaptionTrack", () => {
  it("creates single full-duration clipitem", () => {
    const clips = buildCaptionTrack("/overlay/captions.mov", 30);
    assert.equal(clips.length, 1);
    assert.ok(clips[0].includes('id="captions-overlay"'));
    assert.ok(clips[0].includes("<start>0</start>"));
    assert.ok(clips[0].includes("<end>900</end>")); // 30s * 30fps
  });

  it("returns empty for missing path", () => {
    assert.deepEqual(buildCaptionTrack("", 30), []);
    assert.deepEqual(buildCaptionTrack(null, 30), []);
  });

  it("returns empty for zero duration", () => {
    assert.deepEqual(buildCaptionTrack("/overlay/cap.mov", 0), []);
  });
});

describe("buildTermFlashTrack", () => {
  it("creates single full-duration clipitem", () => {
    const clips = buildTermFlashTrack("/overlay/terms.mov", 30);
    assert.equal(clips.length, 1);
    assert.ok(clips[0].includes('id="termflash-overlay"'));
  });

  it("returns empty for missing inputs", () => {
    assert.deepEqual(buildTermFlashTrack("", 30), []);
    assert.deepEqual(buildTermFlashTrack("/x.mov", 0), []);
  });
});

describe("generateXmeml", () => {
  it("produces valid xmeml structure", () => {
    const xml = generateXmeml({
      name: "Test Timeline",
      totalDuration: 30,
      arollSegments: [{ start: 0, end: 10 }, { start: 15, end: 25 }],
      recordingPath: "/test/recording.mp4",
      brollPlacements: [{ insertAt: 10, duration: 3, clipPath: "/broll/clip.mp4" }],
      captionOverlayPath: "/overlay/captions.mov",
      termFlashOverlayPath: "/overlay/terms.mov",
    });

    // XML declaration
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes("<!DOCTYPE xmeml>"));
    assert.ok(xml.includes('<xmeml version="5">'));

    // Sequence metadata
    assert.ok(xml.includes("<name>Test Timeline</name>"));
    assert.ok(xml.includes("<duration>900</duration>")); // 30s * 30fps
    assert.ok(xml.includes("<timebase>30</timebase>"));
    assert.ok(xml.includes("<ntsc>FALSE</ntsc>"));

    // Has 4 video tracks (V1-V4)
    const trackCount = (xml.match(/<track/g) || []).length;
    assert.ok(trackCount >= 4, `Expected at least 4 tracks, got ${trackCount}`);

    // V1: A-roll clips
    assert.ok(xml.includes('id="aroll-1"'));
    assert.ok(xml.includes('id="aroll-2"'));

    // V2: B-roll
    assert.ok(xml.includes('id="broll-1"'));

    // V3: Captions
    assert.ok(xml.includes('id="captions-overlay"'));

    // V4: Term flashes
    assert.ok(xml.includes('id="termflash-overlay"'));

    // Audio track
    assert.ok(xml.includes('id="audio-main"'));

    // Closing tags
    assert.ok(xml.includes("</xmeml>"));
  });

  it("handles empty params", () => {
    const xml = generateXmeml({});
    assert.ok(xml.includes('<xmeml version="5">'));
    assert.ok(xml.includes("<duration>0</duration>"));
  });

  it("handles null params", () => {
    const xml = generateXmeml(null);
    assert.ok(xml.includes('<xmeml version="5">'));
  });

  it("uses custom fps", () => {
    const xml = generateXmeml({
      totalDuration: 10,
      options: { fps: 24 },
    });
    assert.ok(xml.includes("<timebase>24</timebase>"));
    assert.ok(xml.includes("<duration>240</duration>")); // 10s * 24fps
  });

  it("has frame-accurate timecodes (no floating point)", () => {
    const xml = generateXmeml({
      totalDuration: 10.5,
      arollSegments: [{ start: 0.033, end: 5.017 }],
      recordingPath: "/test/rec.mp4",
    });

    // All numeric values in start/end/in/out/duration should be integers
    const numericTags = xml.match(/<(start|end|in|out|duration)>([^<]+)<\//g) || [];
    for (const tag of numericTags) {
      const value = tag.match(/>([^<]+)</)[1];
      const num = Number(value);
      assert.ok(Number.isInteger(num), `Expected integer, got ${value} in ${tag}`);
    }
  });

  it("maps tracks correctly: V1=A-roll, V2=B-roll, V3=Captions, V4=TermFlash", () => {
    const xml = generateXmeml({
      totalDuration: 30,
      arollSegments: [{ start: 0, end: 10 }],
      recordingPath: "/rec.mp4",
      brollPlacements: [{ insertAt: 5, duration: 2, clipPath: "/b.mp4" }],
      captionOverlayPath: "/cap.mov",
      termFlashOverlayPath: "/term.mov",
    });

    // V1 (A-roll) should come before V2 (B-roll) in the XML
    const arollPos = xml.indexOf('id="aroll-1"');
    const brollPos = xml.indexOf('id="broll-1"');
    const captionPos = xml.indexOf('id="captions-overlay"');
    const termPos = xml.indexOf('id="termflash-overlay"');

    assert.ok(arollPos < brollPos, "V1 (A-roll) should precede V2 (B-roll)");
    assert.ok(brollPos < captionPos, "V2 (B-roll) should precede V3 (Captions)");
    assert.ok(captionPos < termPos, "V3 (Captions) should precede V4 (Term Flashes)");
  });
});

describe("exportFcpXml", () => {
  const testPath = join(process.cwd(), "test-output-fcp.xml");

  afterEach(() => {
    try { unlinkSync(testPath); } catch {}
  });

  it("writes valid XML to file", async () => {
    const result = await exportFcpXml({
      name: "Export Test",
      totalDuration: 10,
      arollSegments: [{ start: 0, end: 5 }],
      recordingPath: "/test/rec.mp4",
    }, testPath);

    assert.equal(result, testPath);
    assert.ok(existsSync(testPath));

    const content = await readFile(testPath, "utf-8");
    assert.ok(content.includes('<xmeml version="5">'));
    assert.ok(content.includes("Export Test"));
  });

  it("throws for missing outputPath", async () => {
    await assert.rejects(
      () => exportFcpXml({ name: "Test" }, ""),
      { message: "outputPath is required" }
    );
  });

  it("throws for null outputPath", async () => {
    await assert.rejects(
      () => exportFcpXml({ name: "Test" }, null),
      { message: "outputPath is required" }
    );
  });
});

describe("adversarial — Codex-found edge cases", () => {
  it("toFileUrl percent-encodes spaces in paths", () => {
    const url = toFileUrl("/Users/test/my video folder/clip.mp4");
    assert.ok(!url.includes(" "), "URL should not contain raw spaces");
    assert.ok(url.includes("my%20video%20folder") || url.includes("my+video+folder"),
      "Spaces should be percent-encoded");
  });

  it("toFileUrl handles special characters (#, ?, %)", () => {
    const url = toFileUrl("/Users/test/clip#2.mp4");
    assert.ok(!url.includes("#2"), "Hash should be encoded");
  });

  it("escapeXml strips forbidden XML control characters", () => {
    const result = escapeXml("hello\x00world\x01\x08test");
    assert.ok(!result.includes("\x00"));
    assert.ok(!result.includes("\x01"));
    assert.ok(!result.includes("\x08"));
    assert.ok(result.includes("helloworld"));
    assert.ok(result.includes("test"));
  });

  it("escapeXml preserves allowed control chars (tab, newline, CR)", () => {
    const result = escapeXml("hello\tworld\ntest\r");
    assert.ok(result.includes("\t"));
    assert.ok(result.includes("\n"));
    assert.ok(result.includes("\r"));
  });

  it("buildArollTrack skips segments where end <= start", () => {
    const segments = [
      { start: 10, end: 5 },    // inverted — skip
      { start: 5, end: 5 },     // zero duration — skip
      { start: 0, end: 10 },    // valid
    ];
    const clips = buildArollTrack(segments, "/rec.mp4");
    assert.equal(clips.length, 1);
    assert.ok(clips[0].includes('id="aroll-3"'));
  });

  it("buildArollTrack skips NaN/Infinity segments", () => {
    const segments = [
      { start: NaN, end: 10 },
      { start: 0, end: Infinity },
      { start: 0, end: 5 },
    ];
    const clips = buildArollTrack(segments, "/rec.mp4");
    assert.equal(clips.length, 1);
  });

  it("buildArollTrack uses fileRefOnly for second+ clips (no duplicate file defs)", () => {
    const segments = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];
    const clips = buildArollTrack(segments, "/rec.mp4");
    assert.equal(clips.length, 2);
    // First clip has full file definition
    assert.ok(clips[0].includes("<pathurl>"));
    // Second clip uses self-closing file reference
    assert.ok(clips[1].includes('file id="source-recording"/>'));
  });

  it("buildBrollTrack handles insertAt=0 correctly (nullish coalescing)", () => {
    const placements = [
      { insertAt: 0, duration: 5, clipPath: "/b.mp4" },
    ];
    const clips = buildBrollTrack(placements);
    assert.equal(clips.length, 1);
    assert.ok(clips[0].includes("<start>0</start>"));
    assert.ok(clips[0].includes("<end>150</end>")); // 5s * 30fps
  });

  it("generateXmeml audio track has file reference and rate", () => {
    const xml = generateXmeml({
      totalDuration: 10,
      recordingPath: "/test/recording.mp4",
    });
    assert.ok(xml.includes('id="audio-main"'));
    assert.ok(xml.includes('id="source-recording-audio"'));
    assert.ok(xml.includes("<pathurl>"));
  });

  it("generateClipitem uses outPoint-inPoint for duration", () => {
    const xml = generateClipitem({
      id: "test",
      name: "Test",
      fileId: "f1",
      filePath: "/test.mp4",
      start: 100,
      end: 400,
      inPoint: 50,
      outPoint: 350,
      fps: 30,
      width: 1920,
      height: 1080,
    });
    // Duration should be outPoint - inPoint = 300, not end - start = 300
    assert.ok(xml.includes("<duration>300</duration>"));
  });
});
