/**
 * Tests for the Shorts Extractor module
 *
 * Validates Section boundary detection, Short extraction,
 * duration constraints, and edge cases.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { identifySections, extractShorts, extractShortsFromTakes } from "./shorts-extractor.js";

describe("Shorts Extractor — identifySections", () => {
  it("should map each best take to a Section", () => {
    const bestTakes = [
      { start: 29, end: 34.5, text: "Are you unknowingly consuming toxic substances?" },
      { start: 62.5, end: 75, text: "What if I told you that 69.4% have misleading labels?" },
      { start: 82, end: 100, text: "Heavy metals like lead and arsenic in your protein powder" },
    ];

    const sections = identifySections(bestTakes);
    assert.equal(sections.length, 3);
    assert.equal(sections[0].id, 1);
    assert.equal(sections[1].id, 2);
    assert.equal(sections[2].id, 3);
  });

  it("should preserve time ranges from best takes", () => {
    const bestTakes = [
      { start: 10.5, end: 25.3, text: "Section one content" },
      { start: 40.0, end: 55.7, text: "Section two content" },
    ];

    const sections = identifySections(bestTakes);
    assert.equal(sections[0].start, 10.5);
    assert.equal(sections[0].end, 25.3);
    assert.equal(sections[1].start, 40.0);
    assert.equal(sections[1].end, 55.7);
  });

  it("should compute duration for each section", () => {
    const bestTakes = [
      { start: 0, end: 30, text: "Thirty second section" },
      { start: 35, end: 80, text: "Forty-five second section" },
    ];

    const sections = identifySections(bestTakes);
    assert.equal(sections[0].duration, 30);
    assert.equal(sections[1].duration, 45);
  });

  it("should return empty array for null input", () => {
    assert.deepEqual(identifySections(null), []);
    assert.deepEqual(identifySections(undefined), []);
    assert.deepEqual(identifySections([]), []);
  });
});

describe("Shorts Extractor — extractShorts", () => {
  it("should create one Short per Section", () => {
    const sections = [
      { id: 1, start: 10, end: 40, text: "Section one", duration: 30 },
      { id: 2, start: 50, end: 90, text: "Section two", duration: 40 },
    ];

    const { shorts } = extractShorts(sections);
    assert.equal(shorts.length, 2);
    assert.equal(shorts[0].sectionId, 1);
    assert.equal(shorts[1].sectionId, 2);
  });

  it("should mark shorts under 60s as green confidence", () => {
    const sections = [
      { id: 1, start: 0, end: 45, text: "Under 60s", duration: 45 },
    ];

    const { shorts, warnings } = extractShorts(sections);
    assert.equal(shorts[0].confidence, "green");
    assert.equal(warnings.length, 0);
  });

  it("should mark shorts over 60s as yellow confidence with warning", () => {
    const sections = [
      { id: 1, start: 0, end: 75, text: "Over 60 seconds section that is too long", duration: 75 },
    ];

    const { shorts, warnings } = extractShorts(sections);
    assert.equal(shorts[0].confidence, "yellow");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("exceeds"));
  });

  it("should handle exactly 60s as green", () => {
    const sections = [
      { id: 1, start: 0, end: 60, text: "Exactly 60s", duration: 60 },
    ];

    const { shorts } = extractShorts(sections);
    assert.equal(shorts[0].confidence, "green");
  });

  it("should respect custom maxDuration", () => {
    const sections = [
      { id: 1, start: 0, end: 45, text: "Under custom limit", duration: 45 },
    ];

    const { shorts } = extractShorts(sections, { maxDuration: 30 });
    assert.equal(shorts[0].confidence, "yellow"); // 45s > 30s limit
  });

  it("should return warning for empty sections", () => {
    const { shorts, warnings } = extractShorts([]);
    assert.equal(shorts.length, 0);
    assert.equal(warnings.length, 1);
  });

  it("should handle null input", () => {
    const { shorts, warnings } = extractShorts(null);
    assert.equal(shorts.length, 0);
    assert.ok(warnings.length > 0);
  });
});

describe("Shorts Extractor — extractShortsFromTakes (integration)", () => {
  it("should produce shorts from take selection result", () => {
    const takeResult = {
      bestTakes: [
        { start: 29, end: 34.5, text: "Are you unknowingly consuming toxic substances?" },
        { start: 62.5, end: 75, text: "What if I told you that 69.4% have misleading labels?" },
        { start: 82, end: 100, text: "Heavy metals in your protein powder" },
      ],
      discarded: [],
      stats: { totalSegments: 7, groups: 3, kept: 3, discarded: 4, badTakes: 2 },
    };

    const result = extractShortsFromTakes(takeResult);

    assert.equal(result.shorts.length, 3);
    assert.equal(result.sections.length, 3);
    assert.equal(result.stats.totalShorts, 3);
    assert.ok(result.stats.totalDuration > 0);
  });

  it("should compute correct stats", () => {
    const takeResult = {
      bestTakes: [
        { start: 0, end: 30, text: "Short section" },    // 30s — green
        { start: 40, end: 110, text: "Long section" },    // 70s — yellow
      ],
      discarded: [],
      stats: {},
    };

    const result = extractShortsFromTakes(takeResult);

    assert.equal(result.stats.greenShorts, 1);
    assert.equal(result.stats.yellowShorts, 1);
    assert.equal(result.stats.longestShort, 70);
    assert.equal(result.stats.shortestShort, 30);
    assert.equal(result.stats.avgDuration, 50);
  });

  it("should handle empty bestTakes", () => {
    const takeResult = { bestTakes: [], discarded: [], stats: {} };
    const result = extractShortsFromTakes(takeResult);

    assert.equal(result.shorts.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  it("should handle missing bestTakes property", () => {
    const takeResult = { discarded: [], stats: {} };
    const result = extractShortsFromTakes(takeResult);

    assert.equal(result.shorts.length, 0);
  });
});

describe("Shorts Extractor — real test data", () => {
  it("should work with actual test recording transcript", async () => {
    // Use the take selector to get best takes from real transcript
    const { selectTakes } = await import("./take-selector.js");
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");

    const transcriptPath = join(
      decodeURIComponent(dirname(new URL(import.meta.url).pathname)),
      "..",
      "data",
      "test-recording-transcript.json"
    );

    const transcript = JSON.parse(await readFile(transcriptPath, "utf-8"));
    const takeResult = selectTakes(transcript);
    const result = extractShortsFromTakes(takeResult);

    // The test recording has 7 segments, grouped into ~3-4 unique topics
    assert.ok(result.shorts.length >= 2, `Expected at least 2 shorts, got ${result.shorts.length}`);
    assert.ok(result.shorts.length <= 7, `Expected at most 7 shorts, got ${result.shorts.length}`);

    // Each short should have valid time ranges
    for (const short of result.shorts) {
      assert.ok(short.start >= 0, `Short ${short.id} has negative start`);
      assert.ok(short.end > short.start, `Short ${short.id} end <= start`);
      assert.ok(short.duration > 0, `Short ${short.id} has zero duration`);
      assert.ok(short.text.length > 0, `Short ${short.id} has empty text`);
    }

    // Shorts should be in chronological order
    for (let i = 1; i < result.shorts.length; i++) {
      assert.ok(
        result.shorts[i].start > result.shorts[i - 1].start,
        `Short ${result.shorts[i].id} not in chronological order`
      );
    }
  });
});

describe("Shorts Extractor — adversarial: duration edge cases", () => {
  it("should handle very short sections (< 5 seconds)", () => {
    const takeResult = {
      bestTakes: [
        { start: 10, end: 12, text: "Very brief point" },
      ],
      discarded: [],
      stats: {},
    };

    const result = extractShortsFromTakes(takeResult);
    assert.equal(result.shorts.length, 1);
    assert.equal(result.shorts[0].duration, 2);
    assert.equal(result.shorts[0].confidence, "green");
  });

  it("should handle section at exactly 60.001s as yellow", () => {
    const sections = [
      { id: 1, start: 0, end: 60.001, text: "Just over limit", duration: 60.001 },
    ];

    const { shorts } = extractShorts(sections);
    assert.equal(shorts[0].confidence, "yellow");
  });

  it("should handle many sections (stress test)", () => {
    const bestTakes = Array.from({ length: 20 }, (_, i) => ({
      start: i * 50,
      end: i * 50 + 40,
      text: `Section ${i + 1} content about topic ${i + 1}`,
    }));

    const result = extractShortsFromTakes({ bestTakes, discarded: [], stats: {} });
    assert.equal(result.shorts.length, 20);
    assert.equal(result.stats.totalShorts, 20);
  });
});

describe("Shorts Extractor — adversarial: Codex-found bugs", () => {
  it("identifySections should skip null entries in bestTakes array", () => {
    assert.doesNotThrow(() => {
      const sections = identifySections([null, { start: 10, end: 20, text: "Valid" }]);
      assert.equal(sections.length, 1);
      assert.equal(sections[0].start, 10);
    });
  });

  it("identifySections should skip malformed entries without start/end", () => {
    assert.doesNotThrow(() => {
      const sections = identifySections([{ text: "No timestamps" }, { start: 5, end: 15, text: "Good" }]);
      assert.equal(sections.length, 1);
    });
  });

  it("extractShorts should handle null options", () => {
    assert.doesNotThrow(() => {
      const { shorts } = extractShorts([{ id: 1, start: 0, end: 15, text: "Valid", duration: 15 }], null);
      assert.equal(shorts.length, 1);
    });
  });

  it("extractShorts should handle overlong section with missing text", () => {
    assert.doesNotThrow(() => {
      const { shorts, warnings } = extractShorts([{ id: 1, start: 0, end: 61, duration: 61 }]);
      assert.equal(shorts.length, 1);
      assert.equal(shorts[0].confidence, "yellow");
      assert.ok(warnings[0].includes("(no text)"));
    });
  });

  it("extractShortsFromTakes should handle null takeResult", () => {
    assert.doesNotThrow(() => {
      const result = extractShortsFromTakes(null);
      assert.equal(result.shorts.length, 0);
      assert.ok(result.warnings.length > 0);
    });
  });

  it("extractShortsFromTakes should handle null options", () => {
    const takeResult = {
      bestTakes: [{ start: 0, end: 30, text: "Valid" }],
      discarded: [],
      stats: {},
    };
    assert.doesNotThrow(() => {
      const result = extractShortsFromTakes(takeResult, null);
      assert.equal(result.shorts.length, 1);
    });
  });
});
