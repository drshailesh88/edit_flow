/**
 * Tests for Chapter Title Module — Phase 6
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractChapterTitles,
  deriveTitle,
  getActiveChapterTitle,
  CHAPTER_TITLE_DURATION,
  CHAPTER_TITLE_STYLE,
} from "./chapter-title.js";

describe("CHAPTER_TITLE_DURATION", () => {
  it("is 3 seconds", () => {
    assert.equal(CHAPTER_TITLE_DURATION, 3);
  });
});

describe("CHAPTER_TITLE_STYLE", () => {
  it("has required style properties", () => {
    assert.equal(typeof CHAPTER_TITLE_STYLE.fontSize, "number");
    assert.equal(typeof CHAPTER_TITLE_STYLE.fontWeight, "number");
    assert.equal(typeof CHAPTER_TITLE_STYLE.color, "string");
    assert.equal(typeof CHAPTER_TITLE_STYLE.backgroundColor, "string");
  });
});

describe("deriveTitle", () => {
  it("extracts numbered heading from text", () => {
    assert.equal(deriveTitle("1. Introduction to protein supplements", 1), "Introduction to protein supplements");
  });

  it("handles colon-separated numbering", () => {
    assert.equal(deriveTitle("2: Heavy metals in protein", 2), "Heavy metals in protein");
  });

  it("handles parenthesis-separated numbering", () => {
    assert.equal(deriveTitle("3) Side effects overview", 3), "Side effects overview");
  });

  it("truncates long headings at 80 chars", () => {
    const longHeading = "1. " + "A".repeat(90);
    const result = deriveTitle(longHeading, 1);
    assert.ok(result.length <= 80);
    assert.ok(result.endsWith("..."));
  });

  it("uses first sentence when no numbered heading", () => {
    assert.equal(deriveTitle("This is about protein. And more stuff here.", 1), "This is about protein");
  });

  it("truncates long first sentence", () => {
    const longSentence = "A".repeat(70) + ". Rest of text.";
    const result = deriveTitle(longSentence, 1);
    assert.ok(result.length <= 60);
    assert.ok(result.endsWith("..."));
  });

  it("falls back to Section N for empty text", () => {
    assert.equal(deriveTitle("", 5), "Section 5");
    assert.equal(deriveTitle(null, 3), "Section 3");
    assert.equal(deriveTitle(undefined, 7), "Section 7");
  });
});

describe("extractChapterTitles", () => {
  it("returns empty array for no sections", () => {
    assert.deepEqual(extractChapterTitles([]), []);
    assert.deepEqual(extractChapterTitles(null), []);
  });

  it("generates chapter titles from sections", () => {
    const sections = [
      { id: 1, start: 0, end: 30, text: "1. Introduction", duration: 30 },
      { id: 2, start: 30, end: 55, text: "2. Heavy metals", duration: 25 },
      { id: 3, start: 55, end: 80, text: "3. Conclusion", duration: 25 },
    ];

    const titles = extractChapterTitles(sections);

    assert.equal(titles.length, 3);

    // First chapter title starts at 0
    assert.equal(titles[0].start, 0);
    assert.equal(titles[0].end, CHAPTER_TITLE_DURATION);
    assert.equal(titles[0].text, "Introduction");
    assert.equal(titles[0].sectionId, 1);

    // Second chapter title starts at end of first section
    assert.equal(titles[1].start, 30);
    assert.equal(titles[1].end, 30 + CHAPTER_TITLE_DURATION);
    assert.equal(titles[1].text, "Heavy metals");

    // Third chapter title starts at end of second section
    assert.equal(titles[2].start, 55);
    assert.equal(titles[2].end, 55 + CHAPTER_TITLE_DURATION);
    assert.equal(titles[2].text, "Conclusion");
  });

  it("assigns correct IDs", () => {
    const sections = [
      { id: 1, start: 0, end: 20, text: "1. First", duration: 20 },
      { id: 2, start: 20, end: 40, text: "2. Second", duration: 20 },
    ];

    const titles = extractChapterTitles(sections);
    assert.equal(titles[0].id, "chapter-1");
    assert.equal(titles[1].id, "chapter-2");
  });

  it("skips sections with invalid start", () => {
    const sections = [
      { id: 1, start: 0, end: 20, text: "1. Valid", duration: 20 },
      { id: 2, start: null, end: 40, text: "2. Invalid", duration: 20 },
    ];

    const titles = extractChapterTitles(sections);
    assert.equal(titles.length, 1);
  });
});

describe("getActiveChapterTitle", () => {
  const titles = [
    { id: "chapter-1", start: 0, end: 3, text: "Introduction" },
    { id: "chapter-2", start: 30, end: 33, text: "Heavy metals" },
  ];

  it("returns active title at given time", () => {
    const result = getActiveChapterTitle(titles, 1);
    assert.equal(result.text, "Introduction");
  });

  it("returns second title at its start time", () => {
    const result = getActiveChapterTitle(titles, 31);
    assert.equal(result.text, "Heavy metals");
  });

  it("returns null between titles", () => {
    const result = getActiveChapterTitle(titles, 15);
    assert.equal(result, null);
  });

  it("returns null at exact end time (exclusive)", () => {
    const result = getActiveChapterTitle(titles, 3);
    assert.equal(result, null);
  });

  it("handles empty array", () => {
    assert.equal(getActiveChapterTitle([], 1), null);
  });

  it("handles null/invalid input", () => {
    assert.equal(getActiveChapterTitle(null, 1), null);
    assert.equal(getActiveChapterTitle(titles, null), null);
  });

  it("ignores malformed title entries instead of throwing", () => {
    const malformedTitles = [
      null,
      { id: "chapter-1", start: 0, end: CHAPTER_TITLE_DURATION, text: "Introduction" },
    ];
    assert.doesNotThrow(() => getActiveChapterTitle(malformedTitles, 1));
    assert.equal(getActiveChapterTitle(malformedTitles, 1).text, "Introduction");
  });
});

describe("extractChapterTitles — adversarial edge cases", () => {
  it("does not crash when invalid entries appear before the first valid section", () => {
    const sections = [
      null,
      { id: 2, start: 10, end: 20, text: "2. Valid section", duration: 10 },
    ];
    assert.doesNotThrow(() => extractChapterTitles(sections));
    const titles = extractChapterTitles(sections);
    assert.equal(titles.length, 1);
    assert.equal(titles[0].start, 0);
    assert.equal(titles[0].text, "Valid section");
  });

  it("skips sections whose start time is NaN", () => {
    const sections = [
      { id: 1, start: NaN, end: 10, text: "1. Broken", duration: 10 },
      { id: 2, start: 10, end: 20, text: "2. Good", duration: 10 },
    ];
    const titles = extractChapterTitles(sections);
    assert.equal(titles.length, 1);
    assert.equal(titles[0].id, "chapter-2");
    assert.equal(titles[0].text, "Good");
  });

  it("does not emit non-finite chapter timing when a previous section has no numeric end", () => {
    const sections = [
      { id: 1, start: 0, end: undefined, text: "1. Missing end", duration: 10 },
      { id: 2, start: 10, end: 20, text: "2. Valid", duration: 10 },
    ];
    const titles = extractChapterTitles(sections);
    for (const t of titles) {
      assert.equal(Number.isFinite(t.start), true);
      assert.equal(Number.isFinite(t.end), true);
    }
  });
});
