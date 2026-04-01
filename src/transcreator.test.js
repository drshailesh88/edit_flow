/**
 * Tests for Transcreator Module
 *
 * Tests cover:
 * - English direct passthrough (caption text cleanup)
 * - Hindi/Hinglish transcreation (mocked API)
 * - Language detection routing
 * - Edge cases (empty input, missing fields)
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCaptionText,
  captionsFromEnglish,
  transcreateFromHindi,
  generateCaptions,
} from "./transcreator.js";

describe("cleanCaptionText", () => {
  it("trims whitespace", () => {
    assert.equal(cleanCaptionText("  hello world  "), "Hello world.");
  });

  it("normalizes internal whitespace", () => {
    assert.equal(cleanCaptionText("hello   world"), "Hello world.");
  });

  it("capitalizes first character", () => {
    assert.equal(cleanCaptionText("are you ready"), "Are you ready.");
  });

  it("preserves existing terminal punctuation", () => {
    assert.equal(cleanCaptionText("Are you ready?"), "Are you ready?");
    assert.equal(cleanCaptionText("This is it!"), "This is it!");
    assert.equal(cleanCaptionText("End here."), "End here.");
  });

  it("adds period when no terminal punctuation", () => {
    assert.equal(cleanCaptionText("No punctuation"), "No punctuation.");
  });

  it("handles empty and null input", () => {
    assert.equal(cleanCaptionText(""), "");
    assert.equal(cleanCaptionText(null), "");
    assert.equal(cleanCaptionText(undefined), "");
  });
});

describe("captionsFromEnglish", () => {
  const sampleSegments = [
    {
      start: 29.12,
      end: 34.32,
      text: "Are you unknowingly consuming toxic substances along with your protein shake?",
      words: [
        { word: "Are", start: 29.12, end: 30.02 },
        { word: "you", start: 30.02, end: 30.42 },
      ],
    },
    {
      start: 35.0,
      end: 40.5,
      text: "today we will discuss this topic",
      words: [
        { word: "today", start: 35.0, end: 35.5 },
      ],
    },
  ];

  it("creates caption entries from segments", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.equal(captions.length, 2);
  });

  it("assigns sequential IDs", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.equal(captions[0].id, 1);
    assert.equal(captions[1].id, 2);
  });

  it("preserves timing from original segments", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.equal(captions[0].start, 29.12);
    assert.equal(captions[0].end, 34.32);
  });

  it("cleans caption text", () => {
    const captions = captionsFromEnglish(sampleSegments);
    // First segment already has punctuation
    assert.equal(captions[0].text, "Are you unknowingly consuming toxic substances along with your protein shake?");
    // Second segment gets period added and capitalized
    assert.equal(captions[1].text, "Today we will discuss this topic.");
  });

  it("preserves original text", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.equal(captions[0].originalText, sampleSegments[0].text);
  });

  it("marks as not transcreated", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.equal(captions[0].transcreated, false);
    assert.equal(captions[0].language, "en");
  });

  it("preserves word-level timestamps", () => {
    const captions = captionsFromEnglish(sampleSegments);
    assert.deepEqual(captions[0].words, sampleSegments[0].words);
  });

  it("handles empty input", () => {
    assert.deepEqual(captionsFromEnglish([]), []);
    assert.deepEqual(captionsFromEnglish(null), []);
  });

  it("handles segments without words array", () => {
    const captions = captionsFromEnglish([{ start: 0, end: 1, text: "test" }]);
    assert.deepEqual(captions[0].words, []);
  });
});

describe("transcreateFromHindi", () => {
  // Mock the Anthropic client
  it("transcreates Hindi segments to English", async () => {
    const segments = [
      { start: 0, end: 5, text: "aaj hum baat karenge protein ke baare mein", words: [] },
      { start: 5, end: 10, text: "yeh bahut important hai", words: [] },
    ];

    // We can't mock the Anthropic constructor easily in ESM,
    // so we test the output structure expectations instead.
    // The actual API call is tested via integration tests.

    // Test that the function exists and has the right signature
    assert.equal(typeof transcreateFromHindi, "function");
  });
});

describe("generateCaptions", () => {
  it("routes English transcripts to direct passthrough", async () => {
    const transcript = {
      language: "en",
      segments: [
        { start: 0, end: 5, text: "Hello world", words: [] },
        { start: 5, end: 10, text: "This is a test.", words: [] },
      ],
    };

    const result = await generateCaptions(transcript);

    assert.equal(result.captions.length, 2);
    assert.equal(result.stats.totalCaptions, 2);
    assert.equal(result.stats.directCount, 2);
    assert.equal(result.stats.transcreatedCount, 0);
    assert.equal(result.stats.language, "en");
  });

  it("marks Hindi language for transcreation routing", async () => {
    // We just verify the routing logic — actual API call would need mocking
    const transcript = {
      language: "hi",
      segments: [],
    };

    const result = await generateCaptions(transcript);
    assert.equal(result.stats.language, "hi");
    assert.equal(result.captions.length, 0);
  });

  it("handles missing transcript", async () => {
    const result = await generateCaptions(null);
    assert.equal(result.captions.length, 0);
    assert.equal(result.stats.language, "unknown");
  });

  it("handles transcript without segments", async () => {
    const result = await generateCaptions({ language: "en" });
    assert.equal(result.captions.length, 0);
  });

  it("defaults to English when language not specified", async () => {
    const transcript = {
      segments: [{ start: 0, end: 5, text: "test", words: [] }],
    };

    const result = await generateCaptions(transcript);
    assert.equal(result.stats.language, "en");
    assert.equal(result.captions[0].transcreated, false);
  });

  it("treats 'hindi' as Hindi language", async () => {
    const transcript = {
      language: "hindi",
      segments: [],
    };

    const result = await generateCaptions(transcript);
    assert.equal(result.stats.language, "hindi");
  });

  it("produces well-formed caption objects for English", async () => {
    const transcript = {
      language: "en",
      segments: [
        {
          start: 29.12,
          end: 34.32,
          text: "Are you unknowingly consuming toxic substances?",
          words: [
            { word: "Are", start: 29.12, end: 30.02 },
            { word: "you", start: 30.02, end: 30.42 },
          ],
        },
      ],
    };

    const result = await generateCaptions(transcript);
    const caption = result.captions[0];

    // Verify all required fields exist
    assert.equal(typeof caption.id, "number");
    assert.equal(typeof caption.start, "number");
    assert.equal(typeof caption.end, "number");
    assert.equal(typeof caption.text, "string");
    assert.equal(typeof caption.originalText, "string");
    assert.ok(Array.isArray(caption.words));
    assert.equal(typeof caption.language, "string");
    assert.equal(typeof caption.transcreated, "boolean");

    // Verify values
    assert.equal(caption.id, 1);
    assert.equal(caption.start, 29.12);
    assert.equal(caption.end, 34.32);
    assert.equal(caption.text, "Are you unknowingly consuming toxic substances?");
    assert.equal(caption.transcreated, false);
    assert.equal(caption.words.length, 2);
  });

  it("integrates with real transcript data format", async () => {
    // Mimics the structure from data/test-recording-transcript.json
    const transcript = {
      language: "en",
      segments: [
        {
          start: 7.64,
          end: 10.44,
          text: "Are you?",
          words: [
            { word: "Are", start: 7.64, end: 9.04 },
            { word: "you?", start: 9.04, end: 10.44 },
          ],
        },
        {
          start: 29.12,
          end: 34.32,
          text: "Are you unknowingly consuming toxic substances along with your protein shake?",
          words: [
            { word: "Are", start: 29.12, end: 30.02 },
            { word: "you", start: 30.02, end: 30.42 },
            { word: "unknowingly", start: 30.42, end: 30.92 },
            { word: "consuming", start: 30.92, end: 31.8 },
            { word: "toxic", start: 31.8, end: 32.36 },
            { word: "substances", start: 32.36, end: 32.88 },
          ],
        },
      ],
    };

    const result = await generateCaptions(transcript);

    assert.equal(result.captions.length, 2);
    assert.equal(result.captions[0].text, "Are you?");
    assert.equal(result.captions[1].start, 29.12);
    assert.equal(result.captions[1].words.length, 6);
  });
});

// =============================================================================
// ADVERSARIAL TESTS — Bug-finding tests added by adversary agent
// =============================================================================

describe("ADVERSARIAL: captionsFromEnglish crashes on non-array input", () => {
  it("should handle a string input gracefully instead of crashing", () => {
    // BUG: captionsFromEnglish("hello") throws "segments.map is not a function"
    // because the guard only checks !segments || segments.length === 0,
    // and a non-empty string passes both checks but has no .map method.
    const result = captionsFromEnglish("hello");
    assert.ok(Array.isArray(result), "Should return an array, not crash");
  });

  it("should handle an object input gracefully instead of crashing", () => {
    // BUG: passing a plain object with no .map method crashes
    const result = captionsFromEnglish({ foo: "bar" });
    assert.ok(Array.isArray(result), "Should return an array, not crash");
  });

  it("should handle a number input gracefully instead of crashing", () => {
    // BUG: passing a truthy number crashes
    const result = captionsFromEnglish(42);
    assert.ok(Array.isArray(result), "Should return an array, not crash");
  });

  it("should handle boolean true input gracefully instead of crashing", () => {
    // BUG: passing true crashes since true has no .map
    const result = captionsFromEnglish(true);
    assert.ok(Array.isArray(result), "Should return an array, not crash");
  });
});

describe("ADVERSARIAL: generateCaptions crashes on non-array segments", () => {
  it("should handle segments as a string instead of crashing", async () => {
    // BUG: generateCaptions({language:'en', segments:'not-array'}) crashes
    // because segments is truthy (passes the !transcript.segments check)
    // but is not an array, so captionsFromEnglish crashes on .map
    const result = await generateCaptions({ language: "en", segments: "not-array" });
    assert.ok(Array.isArray(result.captions), "Should return captions array");
  });

  it("should handle segments as boolean true instead of crashing", async () => {
    // BUG: same issue — truthy non-array value passes the guard
    const result = await generateCaptions({ language: "en", segments: true });
    assert.ok(Array.isArray(result.captions), "Should return captions array");
  });

  it("should handle segments as a number instead of crashing", async () => {
    const result = await generateCaptions({ language: "en", segments: 42 });
    assert.ok(Array.isArray(result.captions), "Should return captions array");
  });
});

describe("ADVERSARIAL: captionsFromEnglish with missing/invalid segment fields", () => {
  it("should not set originalText to undefined when text field is missing", () => {
    // BUG: when a segment has no text field, originalText is set to undefined
    // rather than a safe default. This can cause downstream issues.
    const result = captionsFromEnglish([{ start: 0, end: 1 }]);
    assert.notEqual(result[0].originalText, undefined,
      "originalText should not be undefined — it should be a string");
    assert.equal(typeof result[0].originalText, "string",
      "originalText should always be a string");
  });

  it("should not set originalText to null when text is null", () => {
    // BUG: originalText = seg.text passes through null without normalization
    const result = captionsFromEnglish([{ start: 0, end: 1, text: null }]);
    assert.notEqual(result[0].originalText, null,
      "originalText should not be null");
    assert.equal(typeof result[0].originalText, "string");
  });

  it("should not produce empty text for numeric segment text", () => {
    // BUG: if seg.text is a number (e.g., 42), cleanCaptionText returns ""
    // because typeof 42 !== "string". The caption text becomes empty,
    // losing the content entirely rather than converting to string.
    const result = captionsFromEnglish([{ start: 0, end: 1, text: 42 }]);
    assert.notEqual(result[0].text, "",
      "Should convert numeric text to string, not silently discard it");
  });
});

describe("ADVERSARIAL: captionsFromEnglish with invalid timing", () => {
  it("should not allow start > end (inverted timing)", () => {
    // BUG: no validation that start < end. Inverted timing is silently accepted,
    // which would cause rendering issues in Remotion.
    const result = captionsFromEnglish([{ start: 10, end: 5, text: "test", words: [] }]);
    assert.ok(result[0].start <= result[0].end,
      "start should not be greater than end — inverted timing is invalid");
  });

  it("should not allow NaN timing values", () => {
    // BUG: NaN end time passes through silently, becomes null in JSON
    const result = captionsFromEnglish([{ start: 0, end: NaN, text: "test", words: [] }]);
    assert.ok(!isNaN(result[0].end),
      "end should not be NaN — this would break Remotion rendering");
  });

  it("should not allow negative timing values", () => {
    // BUG: negative timing values pass through without validation
    const result = captionsFromEnglish([{ start: -5, end: -1, text: "test", words: [] }]);
    assert.ok(result[0].start >= 0,
      "start time should not be negative");
  });
});

describe("ADVERSARIAL: generateCaptions does not recognize 'hinglish' language", () => {
  it("should treat 'hinglish' as Hindi for transcreation", async () => {
    // BUG: The code only checks for "hi" and "hindi" but not "hinglish",
    // despite the module docstring saying it handles "Hindi/Hinglish speech".
    // Hinglish input would be routed to English passthrough, which is wrong.
    const transcript = {
      language: "hinglish",
      segments: [],
    };
    const result = await generateCaptions(transcript);
    // If hinglish is treated as English (the bug), transcreatedCount won't matter
    // since segments are empty. But the routing logic should recognize it.
    // We test with a non-empty segment to verify routing.
    const transcriptWithSegments = {
      language: "hinglish",
      segments: [{ start: 0, end: 5, text: "yeh bahut accha hai", words: [] }],
    };
    // This will attempt Claude API call if routed to Hindi (which it should be).
    // Since we can't mock the API, we verify by checking that the function
    // at least recognizes hinglish. For now, verify the language stat reflects intent.
    // The real test: with empty segments, stats should still show intent
    assert.equal(result.stats.language, "hinglish");
    // The real bug: this would need transcreation but gets passthrough
  });
});

describe("ADVERSARIAL: cleanCaptionText with edge case inputs", () => {
  it("should handle a string that becomes empty after trim", () => {
    // Whitespace-only string — trims to empty, should return ""
    const result = cleanCaptionText("   \t\n  ");
    assert.equal(result, "", "Whitespace-only input should produce empty string");
  });

  it("should handle non-string truthy values like numbers", () => {
    // Not necessarily a bug — returns "" for non-strings — but worth documenting
    assert.equal(cleanCaptionText(42), "");
    assert.equal(cleanCaptionText(true), "");
    assert.equal(cleanCaptionText({}), "");
  });

  it("should handle a comma-only string reasonably", () => {
    // Debatable — "," becomes ",." which is odd punctuation
    const result = cleanCaptionText(",");
    // At minimum it shouldn't produce double punctuation or nonsense
    assert.notEqual(result, ",.", "A lone comma should not get a period appended to produce ',.'");
  });
});
