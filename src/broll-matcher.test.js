/**
 * Tests for B-roll Matcher Module — Phase 3
 *
 * Tests keyword extraction, scoring, moment identification,
 * and full B-roll matching pipeline.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  extractKeywords,
  scoreMatch,
  findMatches,
  identifyMoments,
  matchBroll,
} from "./broll-matcher.js";
import { openDatabase, indexLibrary } from "./broll-indexer.js";

const TEST_DB = "test-fixtures/broll-matcher-test.db";

// Seed a test database with known clips for predictable matching
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

describe("B-roll Matcher — extractKeywords", () => {
  it("should extract meaningful keywords from medical text", () => {
    const keywords = extractKeywords("The doctor performed surgery in the hospital operating room");
    assert.ok(keywords.includes("doctor"), "should include 'doctor'");
    assert.ok(keywords.includes("surgery"), "should include 'surgery'");
    assert.ok(keywords.includes("hospital"), "should include 'hospital'");
    assert.ok(keywords.includes("operating"), "should include 'operating'");
    assert.ok(!keywords.includes("the"), "should exclude stop word 'the'");
    assert.ok(!keywords.includes("in"), "should exclude stop word 'in'");
  });

  it("should handle empty/null input", () => {
    assert.deepEqual(extractKeywords(""), []);
    assert.deepEqual(extractKeywords(null), []);
    assert.deepEqual(extractKeywords(undefined), []);
  });

  it("should deduplicate keywords", () => {
    const keywords = extractKeywords("hospital hospital hospital doctor");
    const hospitalCount = keywords.filter(k => k === "hospital").length;
    assert.equal(hospitalCount, 1, "should deduplicate");
  });

  it("should strip punctuation", () => {
    const keywords = extractKeywords("Doctor's surgery, in the hospital!");
    // "Doctor's" → "doctor s" → ["doctor"] (s is too short, filtered)
    assert.ok(keywords.includes("doctor"), "should extract 'doctor'");
    assert.ok(keywords.includes("surgery"), "should strip comma");
    assert.ok(keywords.includes("hospital"), "should strip exclamation");
  });
});

describe("B-roll Matcher — scoreMatch", () => {
  const medicalClip = {
    description: "medical surgery room operating table",
    tags: "medical,surgery,room,operating,table",
  };

  it("should score high for exact keyword matches", () => {
    const score = scoreMatch(medicalClip, ["surgery", "medical", "operating"]);
    assert.ok(score > 0.7, `score ${score} should be > 0.7 for exact matches`);
  });

  it("should score zero for completely unrelated keywords", () => {
    const score = scoreMatch(medicalClip, ["pizza", "beach", "surfing"]);
    assert.equal(score, 0, "should score 0 for unrelated keywords");
  });

  it("should score partial for mixed keywords", () => {
    const score = scoreMatch(medicalClip, ["surgery", "pizza", "beach"]);
    assert.ok(score > 0, "should have some score");
    assert.ok(score < 0.7, `score ${score} should be partial`);
  });

  it("should handle null/empty inputs", () => {
    assert.equal(scoreMatch(null, ["test"]), 0);
    assert.equal(scoreMatch(medicalClip, []), 0);
    assert.equal(scoreMatch(medicalClip, null), 0);
  });
});

describe("B-roll Matcher — findMatches", () => {
  before(async () => {
    await seedTestDb();
  });

  after(async () => {
    await rm(TEST_DB, { force: true });
  });

  it("should find medical clips for medical keywords", () => {
    const matches = findMatches(TEST_DB, ["surgery", "hospital", "medical"]);
    assert.ok(matches.length > 0, "should find at least 1 match");
    assert.ok(
      matches[0].clip.description.includes("surgery") ||
      matches[0].clip.description.includes("hospital"),
      "top match should be medical"
    );
  });

  it("should find city clips for city keywords", () => {
    const matches = findMatches(TEST_DB, ["city", "skyline", "night"]);
    assert.ok(matches.length > 0, "should find at least 1 match");
    assert.ok(matches[0].clip.description.includes("city"), "top match should be city");
  });

  it("should respect minScore threshold", () => {
    const matches = findMatches(TEST_DB, ["surgery"], { minScore: 0.9 });
    // With only 1 keyword matching, score should be low
    // High threshold should filter most results
    for (const m of matches) {
      assert.ok(m.score >= 0.9, `score ${m.score} should be >= 0.9`);
    }
  });

  it("should exclude specified clip IDs", () => {
    const firstMatches = findMatches(TEST_DB, ["medical"]);
    assert.ok(firstMatches.length > 0);
    const excludeId = firstMatches[0].clip.id;

    const secondMatches = findMatches(TEST_DB, ["medical"], {
      excludeIds: new Set([excludeId]),
    });
    for (const m of secondMatches) {
      assert.notEqual(m.clip.id, excludeId, "should exclude specified clip");
    }
  });

  it("should return empty for completely unmatched keywords", () => {
    const matches = findMatches(TEST_DB, ["xyznonexistent", "abcfakeword"]);
    assert.equal(matches.length, 0, "should find no matches");
  });
});

describe("B-roll Matcher — identifyMoments", () => {
  const segments = [
    { start: 0, end: 8, text: "Today we're talking about surgery and hospital procedures." },
    { start: 8, end: 14, text: "The operating room needs to be sterile." },
    { start: 14, end: 22, text: "Let me tell you about the city at night." },
    { start: 22, end: 30, text: "The skyline looks beautiful with all the lights." },
    { start: 30, end: 38, text: "Now let's discuss cooking in the kitchen." },
    { start: 38, end: 45, text: "The pan needs to be hot before adding food." },
  ];

  it("should group segments into time windows", () => {
    const moments = identifyMoments(segments, { windowSize: 15 });
    assert.ok(moments.length > 0, "should identify at least 1 moment");
    assert.ok(moments.length <= segments.length, "should have fewer moments than segments");
  });

  it("should extract keywords for each moment", () => {
    const moments = identifyMoments(segments, { windowSize: 15 });
    for (const m of moments) {
      assert.ok(Array.isArray(m.keywords), "moment should have keywords");
      assert.ok(m.start >= 0, "moment should have start time");
      assert.ok(m.end > m.start, "moment should have positive duration");
    }
  });

  it("should handle empty segments", () => {
    const moments = identifyMoments([]);
    assert.equal(moments.length, 0);
  });

  it("should handle null segments", () => {
    const moments = identifyMoments(null);
    assert.equal(moments.length, 0);
  });

  it("should respect window size", () => {
    const smallWindows = identifyMoments(segments, { windowSize: 5 });
    const largeWindows = identifyMoments(segments, { windowSize: 30 });
    assert.ok(
      smallWindows.length >= largeWindows.length,
      "smaller windows should produce more or equal moments"
    );
  });
});

describe("B-roll Matcher — matchBroll (aggressive mode)", () => {
  before(async () => {
    await seedTestDb();
  });

  after(async () => {
    await rm(TEST_DB, { force: true });
  });

  const segments = [
    { start: 0, end: 8, text: "Today we're talking about surgery and hospital procedures." },
    { start: 8, end: 14, text: "The operating room needs to be sterile." },
    { start: 14, end: 22, text: "Let me tell you about the city at night." },
    { start: 22, end: 30, text: "The skyline looks beautiful with all the lights." },
    { start: 30, end: 38, text: "Now let's discuss cooking in the kitchen." },
    { start: 38, end: 45, text: "The pan needs to be hot before adding food." },
  ];

  it("should produce placements for aggressive mode", () => {
    const result = matchBroll(segments, TEST_DB, { mode: "aggressive" });
    assert.ok(result.placements.length > 0, "should have placements");
    assert.ok(result.stats.totalMoments > 0, "should have moments");
    assert.equal(result.stats.mode, "aggressive");
  });

  it("should produce green placements for matching content", () => {
    const result = matchBroll(segments, TEST_DB, { mode: "aggressive" });
    const greenPlacements = result.placements.filter(p => p.confidence === "green");
    assert.ok(greenPlacements.length > 0, "should have at least 1 green placement");
  });

  it("should include clip info in placements", () => {
    const result = matchBroll(segments, TEST_DB, { mode: "aggressive" });
    const withClip = result.placements.filter(p => p.clip !== null);
    assert.ok(withClip.length > 0, "should have placements with clips");
    for (const p of withClip) {
      assert.ok(p.clip.id, "clip should have id");
      assert.ok(p.clip.filePath, "clip should have filePath");
      assert.ok(p.clip.filename, "clip should have filename");
    }
  });

  it("should flag yellow when no match found", () => {
    // Use keywords that won't match any clip
    const noMatchSegments = [
      { start: 0, end: 15, text: "Quantum entanglement in theoretical astrophysics" },
    ];
    const result = matchBroll(noMatchSegments, TEST_DB, { mode: "aggressive" });
    const yellowPlacements = result.placements.filter(p => p.confidence === "yellow");
    assert.ok(yellowPlacements.length > 0, "should flag yellow for no-match");
  });
});

describe("B-roll Matcher — matchBroll (selective mode)", () => {
  before(async () => {
    await seedTestDb();
  });

  after(async () => {
    await rm(TEST_DB, { force: true });
  });

  it("should produce fewer placements than aggressive mode", () => {
    const segments = [
      { start: 0, end: 8, text: "Surgery is an important medical procedure." },
      { start: 8, end: 14, text: "The hospital has many departments." },
      { start: 14, end: 22, text: "Let me show you the city skyline." },
      { start: 22, end: 30, text: "Night lights are beautiful." },
      { start: 30, end: 38, text: "Cooking requires patience." },
      { start: 38, end: 45, text: "The kitchen should be clean." },
    ];

    const aggressive = matchBroll(segments, TEST_DB, { mode: "aggressive" });
    const selective = matchBroll(segments, TEST_DB, { mode: "selective" });

    // Selective mode uses larger windows (30s) so fewer moments
    assert.ok(
      selective.stats.totalMoments <= aggressive.stats.totalMoments,
      `selective (${selective.stats.totalMoments}) should have <= moments than aggressive (${aggressive.stats.totalMoments})`
    );
    assert.equal(selective.stats.mode, "selective");
  });
});

describe("B-roll Matcher — no duplicate clip usage", () => {
  before(async () => {
    await seedTestDb();
  });

  after(async () => {
    await rm(TEST_DB, { force: true });
  });

  it("should not reuse the same clip across different placements", () => {
    // Multiple moments about the same topic — should use different clips
    const segments = [
      { start: 0, end: 14, text: "Medical surgery in the hospital operating room." },
      { start: 14, end: 28, text: "Another surgery procedure in the hospital." },
      { start: 28, end: 42, text: "Third time discussing surgery and hospitals." },
    ];

    const result = matchBroll(segments, TEST_DB, { mode: "aggressive" });
    const usedClipIds = result.placements
      .filter(p => p.clip !== null)
      .map(p => p.clip.id);

    const uniqueIds = new Set(usedClipIds);
    assert.equal(usedClipIds.length, uniqueIds.size, "should not reuse clips");
  });
});


// ============================================================
// ADVERSARIAL TESTS — bugs found by adversary agent
// ============================================================

describe("ADVERSARY — identifyMoments overlapping segments shrink end time", () => {
  it("should not shrink moment end when an overlapping segment has a smaller end time", () => {
    // Bug: currentMoment.end = seg.end overwrites unconditionally.
    // When a shorter overlapping segment is grouped into the moment,
    // the moment's end shrinks, losing coverage of the first segment.
    const segments = [
      { start: 0, end: 20, text: "first long segment about surgery" },
      { start: 5, end: 10, text: "overlapping shorter segment about hospital" },
    ];
    const moments = identifyMoments(segments, { windowSize: 25 });
    assert.equal(moments.length, 1, "should group into 1 moment");
    // The moment should end at 20 (the max), not 10
    assert.equal(moments[0].end, 20,
      `moment end should be 20 (max of segment ends), got ${moments[0].end} — ` +
      "overlapping segment shrunk the moment end from 20 to 10"
    );
  });

  it("should preserve end time with multiple overlapping segments", () => {
    const segments = [
      { start: 0, end: 30, text: "long segment about medical procedures" },
      { start: 2, end: 5, text: "short overlap one" },
      { start: 8, end: 12, text: "short overlap two" },
    ];
    // With windowSize=35, all should group into one moment
    const moments = identifyMoments(segments, { windowSize: 35 });
    assert.equal(moments.length, 1);
    assert.equal(moments[0].end, 30,
      `moment end should be 30 (max), got ${moments[0].end}`
    );
  });
});

describe("ADVERSARY — scoreMatch does not trim tag whitespace", () => {
  it("should score tags with spaces after commas at tag-match level (0.8), not substring level (0.3)", () => {
    // Bug: tags.split(",") produces [" surgery", " hospital"] when
    // tags are "medical, surgery, hospital". tagWords.includes("surgery")
    // fails because " surgery" !== "surgery". Falls through to substring
    // match at 0.3 instead of 0.8.
    const clip = {
      description: "generic clip with no keyword overlap",
      tags: "medical, surgery, hospital, operating",
    };
    const score = scoreMatch(clip, ["surgery", "hospital"]);
    // Each keyword should score 0.8 (tag match), total = 1.6/2 = 0.8
    // Bug causes each to score 0.3 (substring), total = 0.6/2 = 0.3
    assert.ok(score >= 0.7,
      `score should be >= 0.7 for exact tag matches but got ${score} — ` +
      "tags with spaces after commas are not trimmed before comparison"
    );
  });

  it("should handle tags with mixed whitespace patterns", () => {
    const clip = {
      description: "nothing relevant here",
      tags: " nature , forest , stream ",
    };
    const score = scoreMatch(clip, ["nature", "forest", "stream"]);
    // Should get 0.8 per keyword = 2.4/3 = 0.8
    assert.ok(score >= 0.7,
      `score should be >= 0.7 but got ${score} — whitespace in tags not handled`
    );
  });
});

describe("ADVERSARY — extractKeywords filters two-letter domain terms", () => {
  it("should preserve meaningful two-letter domain acronyms like AI, CT, VR", () => {
    // Bug: filter(w => w.length > 2) removes all 2-char words.
    // Domain-specific acronyms like AI, CT, MR, VR, AR are lost,
    // making it impossible to match B-roll for these topics.
    const keywords = extractKeywords("The doctor used AI for CT scan analysis");
    assert.ok(keywords.includes("ai"),
      `keywords should include 'ai' but got [${keywords.join(", ")}] — ` +
      "two-letter words are unconditionally filtered out"
    );
  });

  it("should preserve two-letter acronym VR", () => {
    const keywords = extractKeywords("VR headset for surgery training");
    assert.ok(keywords.includes("vr"),
      `keywords should include 'vr' but got [${keywords.join(", ")}]`
    );
  });
});
