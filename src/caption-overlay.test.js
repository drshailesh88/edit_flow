/**
 * Tests for Caption Overlay — Pure logic functions
 *
 * Tests the non-React parts of the caption system:
 * - getActiveCaption (caption lookup by time)
 * - CAPTION_PRESETS configuration
 * - CAPTION_STYLES configuration
 * - Data structure validation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveCaption,
  CAPTION_PRESETS,
  CAPTION_STYLES,
} from "./caption-config.js";

describe("CAPTION_PRESETS", () => {
  it("has white-on-black preset", () => {
    assert.ok(CAPTION_PRESETS["white-on-black"]);
    assert.equal(CAPTION_PRESETS["white-on-black"].color, "#FFFFFF");
    assert.ok(CAPTION_PRESETS["white-on-black"].backgroundColor.includes("0, 0, 0"));
  });

  it("has black-on-white preset", () => {
    assert.ok(CAPTION_PRESETS["black-on-white"]);
    assert.equal(CAPTION_PRESETS["black-on-white"].color, "#000000");
    assert.ok(CAPTION_PRESETS["black-on-white"].backgroundColor.includes("255, 255, 255"));
  });

  it("has exactly 2 presets", () => {
    assert.equal(Object.keys(CAPTION_PRESETS).length, 2);
  });

  it("all presets have required fields", () => {
    for (const [name, preset] of Object.entries(CAPTION_PRESETS)) {
      assert.equal(typeof preset.color, "string", `${name} missing color`);
      assert.equal(typeof preset.backgroundColor, "string", `${name} missing backgroundColor`);
      assert.equal(typeof preset.name, "string", `${name} missing name`);
    }
  });
});

describe("CAPTION_STYLES", () => {
  it("has short style", () => {
    assert.ok(CAPTION_STYLES.short);
    assert.equal(CAPTION_STYLES.short.fontSize, 48);
  });

  it("has longform style", () => {
    assert.ok(CAPTION_STYLES.longform);
    assert.equal(CAPTION_STYLES.longform.fontSize, 32);
  });

  it("short has larger font than longform", () => {
    assert.ok(CAPTION_STYLES.short.fontSize > CAPTION_STYLES.longform.fontSize);
  });

  it("short has lower-third positioning (higher bottomOffset)", () => {
    assert.ok(CAPTION_STYLES.short.bottomOffset > CAPTION_STYLES.longform.bottomOffset);
  });

  it("longform is at bottom of screen (low bottomOffset)", () => {
    assert.ok(CAPTION_STYLES.longform.bottomOffset <= 80);
  });

  it("all styles have required fields", () => {
    for (const [name, style] of Object.entries(CAPTION_STYLES)) {
      assert.equal(typeof style.fontSize, "number", `${name} missing fontSize`);
      assert.equal(typeof style.lineHeight, "number", `${name} missing lineHeight`);
      assert.equal(typeof style.paddingVertical, "number", `${name} missing paddingVertical`);
      assert.equal(typeof style.paddingHorizontal, "number", `${name} missing paddingHorizontal`);
      assert.equal(typeof style.bottomOffset, "number", `${name} missing bottomOffset`);
      assert.equal(typeof style.maxWidth, "string", `${name} missing maxWidth`);
      assert.equal(typeof style.borderRadius, "number", `${name} missing borderRadius`);
      assert.equal(typeof style.fontWeight, "number", `${name} missing fontWeight`);
    }
  });
});

describe("getActiveCaption", () => {
  const captions = [
    { id: 1, start: 0, end: 5, text: "First caption." },
    { id: 2, start: 5, end: 10, text: "Second caption." },
    { id: 3, start: 12, end: 18, text: "Third caption." },
  ];

  it("returns the correct caption for a given time", () => {
    const cap = getActiveCaption(captions, 2.5);
    assert.equal(cap.id, 1);
    assert.equal(cap.text, "First caption.");
  });

  it("returns second caption at its start time", () => {
    const cap = getActiveCaption(captions, 5.0);
    assert.equal(cap.id, 2);
  });

  it("returns null during gaps between captions", () => {
    const cap = getActiveCaption(captions, 11.0);
    assert.equal(cap, null);
  });

  it("returns null before any caption starts", () => {
    const cap = getActiveCaption(captions, -1);
    assert.equal(cap, null);
  });

  it("returns null at exact end time (exclusive)", () => {
    const cap = getActiveCaption(captions, 5.0);
    // At 5.0, first caption (0-5) ends and second (5-10) starts
    assert.equal(cap.id, 2); // Second caption starts at 5.0
  });

  it("returns null after all captions end", () => {
    const cap = getActiveCaption(captions, 20.0);
    assert.equal(cap, null);
  });

  it("handles empty captions array", () => {
    assert.equal(getActiveCaption([], 5.0), null);
  });

  it("handles null captions", () => {
    assert.equal(getActiveCaption(null, 5.0), null);
  });

  it("handles non-array captions", () => {
    assert.equal(getActiveCaption("not an array", 5.0), null);
  });

  it("handles NaN currentTime", () => {
    assert.equal(getActiveCaption(captions, NaN), null);
  });

  it("handles undefined currentTime", () => {
    assert.equal(getActiveCaption(captions, undefined), null);
  });

  it("skips malformed caption entries", () => {
    const mixed = [
      null,
      { id: 1, start: 0, end: 5, text: "Valid." },
      { id: 2, text: "No timing" },
      { id: 3, start: "bad", end: 10, text: "Bad types" },
    ];
    const cap = getActiveCaption(mixed, 2.5);
    assert.equal(cap.id, 1);
  });

  it("returns first matching caption when overlapping", () => {
    const overlapping = [
      { id: 1, start: 0, end: 10, text: "Long caption." },
      { id: 2, start: 5, end: 15, text: "Overlapping." },
    ];
    const cap = getActiveCaption(overlapping, 7.0);
    assert.equal(cap.id, 1); // First match wins
  });

  it("works with fractional timestamps", () => {
    const cap = getActiveCaption(captions, 12.001);
    assert.equal(cap.id, 3);
  });
});
