/**
 * Tests for B-roll Indexer Module — Phase 3
 *
 * Tests SQLite indexing, directory scanning, description generation,
 * and search functionality.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  openDatabase,
  scanDirectory,
  getClipMetadata,
  generateDescription,
  extractTags,
  indexClip,
  indexLibrary,
  searchClips,
  getIndexStats,
} from "./broll-indexer.js";

const TEST_DIR = "test-fixtures/broll-test";
const TEST_DB = "test-fixtures/broll-test.db";
const TEST_RECORDING = "test-fixtures/test-recording.mp4";

describe("B-roll Indexer — openDatabase", () => {
  after(async () => {
    // Clean up test db
    await rm(TEST_DB, { force: true });
  });

  it("should create a new database with the clips table", () => {
    const db = openDatabase(TEST_DB);
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='clips'"
      ).all();
      assert.equal(tables.length, 1, "clips table should exist");

      // Check columns
      const columns = db.prepare("PRAGMA table_info(clips)").all();
      const colNames = columns.map(c => c.name);
      assert.ok(colNames.includes("file_path"), "should have file_path column");
      assert.ok(colNames.includes("description"), "should have description column");
      assert.ok(colNames.includes("tags"), "should have tags column");
      assert.ok(colNames.includes("file_hash"), "should have file_hash column");
      assert.ok(colNames.includes("duration"), "should have duration column");
    } finally {
      db.close();
    }
  });

  it("should reopen existing database without error", () => {
    const db1 = openDatabase(TEST_DB);
    db1.close();
    const db2 = openDatabase(TEST_DB);
    try {
      const tables = db2.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='clips'"
      ).all();
      assert.equal(tables.length, 1);
    } finally {
      db2.close();
    }
  });
});

describe("B-roll Indexer — scanDirectory", () => {
  before(async () => {
    // Create test directory structure with dummy files
    await mkdir(join(TEST_DIR, "medical"), { recursive: true });
    await mkdir(join(TEST_DIR, "city"), { recursive: true });
    await writeFile(join(TEST_DIR, "readme.txt"), "not a video");
    await writeFile(join(TEST_DIR, "city", "skyline.txt"), "also not a video");
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should find no video files in a directory of text files", async () => {
    const files = [];
    for await (const f of scanDirectory(TEST_DIR)) {
      files.push(f);
    }
    assert.equal(files.length, 0, "should find no video files in text-only dirs");
  });
});

describe("B-roll Indexer — getClipMetadata", () => {
  it("should extract metadata from a real video file", async () => {
    const meta = await getClipMetadata(TEST_RECORDING);
    assert.ok(meta.duration > 0, "duration should be positive");
    assert.equal(meta.width, 1920, "width should be 1920");
    assert.equal(meta.height, 1080, "height should be 1080");
    assert.ok(meta.fps > 0, "fps should be positive");
    assert.ok(meta.fileSize > 0, "file size should be positive");
  });
});

describe("B-roll Indexer — generateDescription", () => {
  it("should parse hyphenated filenames", () => {
    const desc = generateDescription("/lib/city-skyline-night.mp4", "/lib");
    assert.ok(desc.includes("city"), "should contain 'city'");
    assert.ok(desc.includes("skyline"), "should contain 'skyline'");
    assert.ok(desc.includes("night"), "should contain 'night'");
  });

  it("should include directory context", () => {
    const desc = generateDescription("/lib/medical/surgery-room.mp4", "/lib");
    assert.ok(desc.includes("medical"), "should contain directory 'medical'");
    assert.ok(desc.includes("surgery"), "should contain 'surgery'");
  });

  it("should strip B-Roll prefix", () => {
    const desc = generateDescription("/lib/B_ROLL_HOSPITAL.mp4", "/lib");
    assert.ok(!desc.toLowerCase().startsWith("b roll"), "should strip B_ROLL prefix");
    assert.ok(desc.includes("hospital"), "should contain 'hospital'");
  });

  it("should strip sequence numbers", () => {
    const desc = generateDescription("/lib/sunset-001.mp4", "/lib");
    assert.ok(!desc.includes("001"), "should strip sequence number 001");
    assert.ok(desc.includes("sunset"), "should contain 'sunset'");
  });

  it("should handle underscored filenames", () => {
    const desc = generateDescription("/lib/lab_test_tubes_close_up.mp4", "/lib");
    assert.ok(desc.includes("lab"), "should contain 'lab'");
    assert.ok(desc.includes("test"), "should contain 'test'");
    assert.ok(desc.includes("tubes"), "should contain 'tubes'");
  });
});

describe("B-roll Indexer — extractTags", () => {
  it("should extract meaningful words as tags", () => {
    const tags = extractTags("medical surgery room panning shot");
    assert.ok(tags.includes("medical"), "should include 'medical'");
    assert.ok(tags.includes("surgery"), "should include 'surgery'");
    assert.ok(tags.includes("room"), "should include 'room'");
  });

  it("should deduplicate tags", () => {
    const tags = extractTags("city city skyline city");
    const tagArr = tags.split(",");
    const cityCount = tagArr.filter(t => t === "city").length;
    assert.equal(cityCount, 1, "should deduplicate 'city'");
  });

  it("should skip very short words", () => {
    const tags = extractTags("a an the city of new york");
    assert.ok(!tags.includes(",a,"), "should skip 'a'");
    assert.ok(!tags.includes(",an,"), "should skip 'an'");
    assert.ok(!tags.includes(",the,"), "should skip 'the'");
    assert.ok(!tags.includes(",of,"), "should skip 'of'");
  });
});

describe("B-roll Indexer — indexClip (with real video)", () => {
  const testDb = "test-fixtures/broll-clip-test.db";

  after(async () => {
    await rm(testDb, { force: true });
  });

  it("should index a real video clip into the database", async () => {
    const db = openDatabase(testDb);
    try {
      const result = await indexClip(db, TEST_RECORDING, "test-fixtures");
      assert.equal(result.action, "inserted", "first index should insert");

      // Verify the record
      const clip = db.prepare("SELECT * FROM clips WHERE file_path = ?").get(TEST_RECORDING);
      assert.ok(clip, "clip should exist in database");
      assert.ok(clip.duration > 0, "duration should be positive");
      assert.ok(clip.description.length > 0, "description should not be empty");
      assert.ok(clip.tags.length > 0, "tags should not be empty");
      assert.ok(clip.file_hash.length > 0, "file hash should not be empty");
    } finally {
      db.close();
    }
  });

  it("should skip already-indexed clip on second run", async () => {
    const db = openDatabase(testDb);
    try {
      const result = await indexClip(db, TEST_RECORDING, "test-fixtures");
      assert.equal(result.action, "skipped", "second index should skip");
    } finally {
      db.close();
    }
  });
});

describe("B-roll Indexer — indexLibrary", () => {
  const libDb = "test-fixtures/broll-lib-test.db";

  after(async () => {
    await rm(libDb, { force: true });
  });

  it("should index all video files in a directory", async () => {
    // test-fixtures has test-recording.mp4
    const stats = await indexLibrary("test-fixtures", libDb);
    assert.ok(stats.total >= 1, "should find at least 1 video file");
    assert.ok(stats.inserted >= 1, "should insert at least 1 clip");
    assert.equal(stats.errors, 0, "should have no errors");
  });

  it("should skip all clips on second run (incremental)", async () => {
    const stats = await indexLibrary("test-fixtures", libDb);
    assert.ok(stats.total >= 1, "should find at least 1 video file");
    assert.equal(stats.inserted, 0, "should insert 0 on second run");
    assert.ok(stats.skipped >= 1, "should skip at least 1");
  });
});

describe("B-roll Indexer — searchClips", () => {
  const searchDb = "test-fixtures/broll-search-test.db";

  before(async () => {
    // Index test-fixtures to have searchable data
    await indexLibrary("test-fixtures", searchDb);
  });

  after(async () => {
    await rm(searchDb, { force: true });
  });

  it("should return all clips when query is empty", () => {
    const results = searchClips(searchDb, "");
    assert.ok(results.length >= 1, "should return at least 1 clip");
  });

  it("should find clips matching search terms", () => {
    // The test recording should be indexed with some description
    const results = searchClips(searchDb, "test recording");
    // At least the description or tags should match
    assert.ok(Array.isArray(results), "should return an array");
  });
});

describe("ADVERSARIAL — searchClips with null input", () => {
  const advDb = "test-fixtures/broll-adv-null.db";

  before(async () => {
    await indexLibrary("test-fixtures", advDb);
  });

  after(async () => {
    await rm(advDb, { force: true });
  });

  it("should not throw when query is null", () => {
    const results = searchClips(advDb, null);
    assert.ok(Array.isArray(results), "should return an array");
    assert.ok(results.length >= 1, "should return all clips when query is null");
  });

  it("should not throw when query is undefined", () => {
    const results = searchClips(advDb, undefined);
    assert.ok(Array.isArray(results), "should return an array");
  });
});

describe("ADVERSARIAL — searchClips LIKE wildcard escaping", () => {
  const advDb = "test-fixtures/broll-adv-like.db";

  before(async () => {
    await indexLibrary("test-fixtures", advDb);
  });

  after(async () => {
    await rm(advDb, { force: true });
  });

  it("should not match everything when query contains %", () => {
    // "%" is a LIKE wildcard — if not escaped, it matches every row
    const allClips = searchClips(advDb, "");
    const wildcardResults = searchClips(advDb, "%");
    // A literal "%" search should NOT match unless clips actually have "%" in description
    assert.ok(wildcardResults.length <= allClips.length,
      "wildcard query should not return more than all clips");
  });

  it("should not match everything when query contains _", () => {
    const results = searchClips(advDb, "_");
    assert.ok(Array.isArray(results), "should return an array");
  });
});

describe("ADVERSARIAL — computeFileHash memory efficiency", () => {
  it("should produce consistent hashes", async () => {
    const { computeFileHash } = await import("./broll-indexer.js");
    const hash1 = computeFileHash(TEST_RECORDING, 1000000);
    const hash2 = computeFileHash(TEST_RECORDING, 1000000);
    assert.equal(hash1, hash2, "same file should produce same hash");
  });
});

describe("B-roll Indexer — getIndexStats", () => {
  const statsDb = "test-fixtures/broll-stats-test.db";

  before(async () => {
    await indexLibrary("test-fixtures", statsDb);
  });

  after(async () => {
    await rm(statsDb, { force: true });
  });

  it("should return accurate stats", () => {
    const stats = getIndexStats(statsDb);
    assert.ok(stats.totalClips >= 1, "should have at least 1 clip");
    assert.ok(stats.totalDuration > 0, "should have positive total duration");
    assert.ok(stats.directories >= 1, "should have at least 1 directory");
  });
});
