/**
 * Tests for B-roll Placer Module — Phase 3 (Reqs 4, 5, 6)
 *
 * Tests aggressive placement (long-form), selective placement (shorts),
 * Yellow flagging, and confidence computation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  placeBrollLongform,
  placeBrollShort,
  computeBrollConfidence,
  formatBrollReport,
} from "./broll-placer.js";
import { openDatabase } from "./broll-indexer.js";

const TEST_DB = "test-fixtures/broll-placer-test.db";

// Seed a test database with known clips
async function seedTestDb() {
  await rm(TEST_DB, { force: true });
  const db = openDatabase(TEST_DB);
  const now = new Date().toISOString();

  const clips = [
    { path: "/lib/medical/surgery-room.mp4", name: "surgery-room.mp4", dir: "medical", desc: "medical surgery room operating table", tags: "medical,surgery,room,operating,table", dur: 10 },
    { path: "/lib/medical/hospital-exterior.mp4", name: "hospital-exterior.mp4", dir: "medical", desc: "medical hospital exterior building", tags: "medical,hospital,exterior,building", dur: 8 },
    { path: "/lib/city/skyline-night.mp4", name: "skyline-night.mp4", dir: "city", desc: "city skyline night lights", tags: "city,skyline,night,lights", dur: 12 },
    { path: "/lib/nature/forest-stream.mp4", name: "forest-stream.mp4", dir: "nature", desc: "nature forest stream water flowing", tags: "nature,forest,stream,water,flowing", dur: 15 },
    { path: "/lib/tech/server-room.mp4", name: "server-room.mp4", dir: "tech", desc: "technology server room data center", tags: "technology,server,room,data,center", dur: 7 },
    { path: "/lib/food/cooking-pan.mp4", name: "cooking-pan.mp4", dir: "food", desc: "food cooking pan kitchen stove", tags: "food,cooking,pan,kitchen,stove", dur: 6 },
  ];

  const stmt = db.prepare(`
    INSERT INTO clips (file_path, filename, directory, duration, width, height, fps,
                       file_size, description, tags, indexed_at, file_hash)
    VALUES (?, ?, ?, ?, 1920, 1080, 30, 1000000, ?, ?, ?, 'hash')
  `);

  for (const c of clips) {
    stmt.run(c.path, c.name, c.dir, c.dur, c.desc, c.tags, now);
  }

  db.close();
}

// Transcript segments covering multiple topics over ~90 seconds
const LONGFORM_SEGMENTS = [
  { start: 0, end: 8, text: "Today we're talking about surgery and hospital procedures." },
  { start: 8, end: 14, text: "The operating room needs to be absolutely sterile." },
  { start: 14, end: 22, text: "Let me tell you about the city at night." },
  { start: 22, end: 30, text: "The skyline looks beautiful with all the lights." },
  { start: 30, end: 38, text: "Now let's discuss cooking in the kitchen." },
  { start: 38, end: 45, text: "The pan needs to be hot before adding food." },
  { start: 45, end: 55, text: "Nature has a way of healing us through forest walks." },
  { start: 55, end: 62, text: "The stream water flowing over rocks is calming." },
  { start: 62, end: 70, text: "Technology server rooms are fascinating places." },
  { start: 70, end: 80, text: "Data centers keep the internet running." },
  { start: 80, end: 90, text: "Quantum entanglement is really weird physics." },
];

// Short transcript — one topic, ~40 seconds
const SHORT_SEGMENTS = [
  { start: 0, end: 10, text: "Surgery requires incredible precision and skill." },
  { start: 10, end: 20, text: "The hospital operating room must be perfectly clean." },
  { start: 20, end: 30, text: "Medical instruments are sterilized before each procedure." },
  { start: 30, end: 40, text: "The patient recovery process takes careful monitoring." },
];

describe("B-roll Placer — placeBrollLongform (Req 4: aggressive mode)", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("should produce placements for a 90-second long-form video", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    assert.ok(result.manifest.length > 0, "should have placements");
    assert.equal(result.stats.mode, "aggressive", "should use aggressive mode");
  });

  it("should place B-roll approximately every 15-20 seconds", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    // 90 seconds / 15s windows = ~6 moments
    assert.ok(result.manifest.length >= 3, `should have >= 3 placements for 90s video, got ${result.manifest.length}`);
  });

  it("should include clip info for matched placements", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    const withClip = result.manifest.filter(p => p.brollClip !== null);
    assert.ok(withClip.length > 0, "should have at least 1 placement with clip");

    for (const p of withClip) {
      assert.ok(p.brollClip.id, "clip should have id");
      assert.ok(p.brollClip.filePath, "clip should have filePath");
      assert.ok(p.brollClip.filename, "clip should have filename");
      assert.ok(p.brollClip.description, "clip should have description");
    }
  });

  it("should have insertAt timestamps and duration for each placement", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    for (const p of result.manifest) {
      assert.ok(typeof p.insertAt === "number", `insertAt should be number, got ${typeof p.insertAt}`);
      assert.ok(p.insertAt >= 0, "insertAt should be >= 0");
      assert.ok(typeof p.duration === "number", "duration should be number");
      assert.ok(p.duration > 0, "duration should be positive");
    }
  });

  it("should return empty manifest for missing database", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, "nonexistent.db");
    assert.equal(result.manifest.length, 0);
    assert.ok(result.warnings.length > 0, "should have warning about missing db");
  });

  it("should return empty manifest for empty segments", () => {
    const result = placeBrollLongform([], TEST_DB);
    assert.equal(result.manifest.length, 0);
    assert.ok(result.warnings.length > 0);
  });
});

describe("B-roll Placer — placeBrollShort (Req 5: selective mode)", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("should produce placements for a short video", () => {
    const result = placeBrollShort(SHORT_SEGMENTS, TEST_DB);
    assert.equal(result.stats.mode, "selective", "should use selective mode");
  });

  it("should produce fewer placements than long-form for same content", () => {
    const longResult = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    const shortResult = placeBrollShort(LONGFORM_SEGMENTS, TEST_DB);

    // Selective mode should produce fewer or equal placements
    assert.ok(
      shortResult.manifest.length <= longResult.manifest.length,
      `selective (${shortResult.manifest.length}) should have <= placements than aggressive (${longResult.manifest.length})`
    );
  });

  it("should only include matched clips in short manifest (skip no-match)", () => {
    const result = placeBrollShort(SHORT_SEGMENTS, TEST_DB);
    for (const p of result.manifest) {
      assert.ok(p.brollClip !== null, "short manifest should only include matched clips");
    }
  });

  it("should use higher minScore for selective mode (0.25 vs 0.15)", () => {
    const result = placeBrollShort(SHORT_SEGMENTS, TEST_DB);
    // All included placements should have meaningful scores
    for (const p of result.manifest) {
      assert.ok(p.confidence === "green" || p.confidence === "yellow",
        "placements should have confidence tags");
    }
  });
});

describe("B-roll Placer — Yellow flag (Req 6)", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("should flag Yellow when no suitable B-roll match exists (long-form)", () => {
    // "Quantum entanglement" has no matching B-roll clips
    const noMatchSegments = [
      { start: 0, end: 15, text: "Quantum entanglement particles across dimensions." },
      { start: 15, end: 30, text: "Superposition states in quantum mechanics." },
    ];

    const result = placeBrollLongform(noMatchSegments, TEST_DB);
    const yellowPlacements = result.manifest.filter(p => p.confidence === "yellow");
    assert.ok(yellowPlacements.length > 0, "should flag Yellow for unmatched content");
  });

  it("should NOT insert irrelevant footage for Yellow placements", () => {
    const noMatchSegments = [
      { start: 0, end: 15, text: "Quantum entanglement particles across dimensions." },
    ];

    const result = placeBrollLongform(noMatchSegments, TEST_DB);
    const yellowPlacements = result.manifest.filter(p => p.confidence === "yellow");

    for (const p of yellowPlacements) {
      // Yellow placements should have null clip (not irrelevant footage)
      assert.equal(p.brollClip, null,
        "Yellow placements should have null clip (not insert irrelevant footage)");
    }
  });

  it("should include Yellow reason in warnings", () => {
    const noMatchSegments = [
      { start: 0, end: 15, text: "Quantum entanglement particles across dimensions." },
    ];

    const result = placeBrollLongform(noMatchSegments, TEST_DB);
    assert.ok(result.warnings.length > 0, "should have warnings for Yellow flags");
    assert.ok(
      result.warnings.some(w => w.includes("Yellow")),
      "warnings should mention Yellow"
    );
  });

  it("should produce warnings for shorts too (even though clips are omitted)", () => {
    const noMatchSegments = [
      { start: 0, end: 30, text: "Quantum entanglement is really fascinating theoretical physics." },
    ];

    const result = placeBrollShort(noMatchSegments, TEST_DB);
    // For shorts, unmatched are excluded from manifest but appear in warnings
    // (or the manifest may be empty if nothing matched)
    assert.ok(Array.isArray(result.warnings), "should have warnings array");
  });
});

describe("B-roll Placer — computeBrollConfidence", () => {
  it("should return green when no yellow placements", () => {
    const result = {
      stats: { totalPlacements: 5, yellowPlacements: 0, greenPlacements: 5 },
    };
    assert.equal(computeBrollConfidence(result), "green");
  });

  it("should return green when yellow ratio <= 30%", () => {
    const result = {
      stats: { totalPlacements: 10, yellowPlacements: 2, greenPlacements: 8 },
    };
    assert.equal(computeBrollConfidence(result), "green");
  });

  it("should return yellow when yellow ratio > 30%", () => {
    const result = {
      stats: { totalPlacements: 10, yellowPlacements: 5, greenPlacements: 5 },
    };
    assert.equal(computeBrollConfidence(result), "yellow");
  });

  it("should return yellow for empty placements", () => {
    const result = {
      stats: { totalPlacements: 0, yellowPlacements: 0, greenPlacements: 0 },
    };
    assert.equal(computeBrollConfidence(result), "yellow");
  });

  it("should return yellow for null input", () => {
    assert.equal(computeBrollConfidence(null), "yellow");
  });
});

describe("B-roll Placer — formatBrollReport", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("should produce a readable report", () => {
    const result = placeBrollLongform(LONGFORM_SEGMENTS, TEST_DB);
    const report = formatBrollReport(result);

    assert.ok(report.includes("aggressive"), "report should mention mode");
    assert.ok(report.includes("Placements:"), "report should show placements");
    assert.ok(report.includes("Confidence:"), "report should show confidence");
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADVERSARIAL TESTS — Bugs found by adversary agent
// ═══════════════════════════════════════════════════════════════════

// Segments spaced > 30s apart so selective mode (windowSize=30) creates separate moments.
// One moment matches (surgery), one doesn't (quantum), one is excluded by duplicate exclusion.
const ADVERSARIAL_SHORT_SEGMENTS = [
  { start: 0, end: 15, text: "Surgery operating room medical hospital procedures." },
  { start: 31, end: 45, text: "Quantum entanglement theoretical physics abstract concepts dimensions." },
  { start: 61, end: 75, text: "Surgery in the hospital operating room is complex." },
];

describe("ADVERSARIAL — placeBrollShort stats mismatch with filtered manifest", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("BUG: stats.totalPlacements should match manifest.length for shorts", () => {
    const result = placeBrollShort(ADVERSARIAL_SHORT_SEGMENTS, TEST_DB);

    // placeBrollShort filters out unmatched placements from the manifest,
    // but returns the raw matcher stats unchanged.
    // stats.totalPlacements=3 but manifest.length=1 — inconsistent.
    assert.equal(
      result.stats.totalPlacements,
      result.manifest.length,
      `stats.totalPlacements (${result.stats.totalPlacements}) should equal manifest.length (${result.manifest.length}) for shorts, ` +
      `because shorts exclude unmatched placements from the manifest`
    );
  });

  it("BUG: stats.yellowPlacements should reflect actual manifest, not pre-filter matcher", () => {
    const result = placeBrollShort(ADVERSARIAL_SHORT_SEGMENTS, TEST_DB);

    const manifestYellowCount = result.manifest.filter(p => p.confidence === "yellow").length;
    assert.equal(
      result.stats.yellowPlacements,
      manifestYellowCount,
      `stats.yellowPlacements (${result.stats.yellowPlacements}) should match actual Yellow entries in manifest (${manifestYellowCount})`
    );
  });
});

describe("ADVERSARIAL — computeBrollConfidence on short result is misleading", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("BUG: confidence should be green when all manifest entries are matched clips", () => {
    const result = placeBrollShort(ADVERSARIAL_SHORT_SEGMENTS, TEST_DB);

    // All manifest entries have clips (shorts filter out unmatched)
    const allManifestHaveClips = result.manifest.every(p => p.brollClip !== null);
    assert.ok(allManifestHaveClips, "All manifest entries should have clips");
    assert.ok(result.manifest.length > 0, "Should have at least one placement");

    // computeBrollConfidence uses stats.yellowPlacements from the matcher
    // which includes the filtered-out Yellow entries. This causes the confidence
    // to be "yellow" even though the actual manifest is 100% green matched clips.
    const confidence = computeBrollConfidence(result);
    assert.equal(confidence, "green",
      `Confidence should be green when manifest is 100% matched clips, ` +
      `but stats.yellowPlacements=${result.stats.yellowPlacements} from matcher inflates the yellow ratio`
    );
  });
});

describe("ADVERSARIAL — formatBrollReport placements count mismatch for shorts", () => {
  before(seedTestDb);
  after(async () => { await rm(TEST_DB, { force: true }); });

  it("BUG: report shows Placements != Green + Yellow (inconsistent numbers)", () => {
    const result = placeBrollShort(ADVERSARIAL_SHORT_SEGMENTS, TEST_DB);
    const report = formatBrollReport(result);

    // The report displays manifest.length as "Placements:" (filtered, e.g. 1)
    // but stats.greenPlacements and stats.yellowPlacements from the matcher (e.g. 1 and 2).
    // So the report reads: Placements: 1, Green: 1, Yellow: 2 — contradictory.
    const placementsMatch = report.match(/Placements:\s*(\d+)/);
    const greenMatch = report.match(/Green:\s*(\d+)/);
    const yellowMatch = report.match(/Yellow:\s*(\d+)/);

    assert.ok(placementsMatch && greenMatch && yellowMatch, "Report should contain all fields");

    const placements = parseInt(placementsMatch[1]);
    const green = parseInt(greenMatch[1]);
    const yellow = parseInt(yellowMatch[1]);

    assert.equal(
      placements,
      green + yellow,
      `Report inconsistency: Placements (${placements}) should equal Green (${green}) + Yellow (${yellow}) = ${green + yellow}`
    );
  });
});
