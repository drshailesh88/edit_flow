/**
 * Tests for TermFlash Configuration
 *
 * Tests cover:
 * - getActiveTermFlash (flash lookup by time with opacity)
 * - computeFlashOpacity (fade in/out transitions)
 * - checkCaptionCollision (collision detection)
 * - getSafeFlashPosition (safe positioning)
 * - TERMFLASH_STYLE configuration
 * - TERMFLASH_POSITION configuration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TERMFLASH_STYLE,
  TERMFLASH_POSITION,
  getActiveTermFlash,
  computeFlashOpacity,
  checkCaptionCollision,
  getSafeFlashPosition,
} from "./termflash-config.js";

describe("TERMFLASH_STYLE", () => {
  it("has white text", () => {
    assert.equal(TERMFLASH_STYLE.color, "#FFFFFF");
  });

  it("has semi-transparent dark background", () => {
    assert.ok(TERMFLASH_STYLE.backgroundColor.includes("0, 0, 0"));
    assert.ok(TERMFLASH_STYLE.backgroundColor.includes("0.65"));
  });

  it("uses clean sans-serif font", () => {
    assert.ok(TERMFLASH_STYLE.fontFamily.includes("Inter"));
    assert.ok(TERMFLASH_STYLE.fontFamily.includes("sans-serif"));
  });

  it("has 0.3s fade durations", () => {
    assert.equal(TERMFLASH_STYLE.fadeInDuration, 0.3);
    assert.equal(TERMFLASH_STYLE.fadeOutDuration, 0.3);
  });

  it("has all required style fields", () => {
    assert.equal(typeof TERMFLASH_STYLE.fontSize, "number");
    assert.equal(typeof TERMFLASH_STYLE.fontWeight, "number");
    assert.equal(typeof TERMFLASH_STYLE.paddingVertical, "number");
    assert.equal(typeof TERMFLASH_STYLE.paddingHorizontal, "number");
    assert.equal(typeof TERMFLASH_STYLE.borderRadius, "number");
    assert.equal(typeof TERMFLASH_STYLE.maxWidth, "string");
  });
});

describe("TERMFLASH_POSITION", () => {
  it("has short and longform positions", () => {
    assert.ok(TERMFLASH_POSITION.short);
    assert.ok(TERMFLASH_POSITION.longform);
  });

  it("positions in upper area of screen", () => {
    // Both should be in the top portion (< 200px)
    assert.ok(TERMFLASH_POSITION.short.top < 200);
    assert.ok(TERMFLASH_POSITION.longform.top < 200);
  });
});

describe("computeFlashOpacity", () => {
  it("returns 0 before flash starts", () => {
    assert.equal(computeFlashOpacity(5, 8, 4), 0);
  });

  it("returns 0 after flash ends", () => {
    assert.equal(computeFlashOpacity(5, 8, 9), 0);
  });

  it("returns 1 during full visibility (middle)", () => {
    assert.equal(computeFlashOpacity(5, 8, 6.5), 1);
  });

  it("fades in during first 0.3s", () => {
    const opacity = computeFlashOpacity(5, 8, 5.15); // 0.15s in, half of 0.3s fade
    assert.ok(opacity > 0 && opacity < 1, `Expected partial opacity, got ${opacity}`);
    assert.ok(Math.abs(opacity - 0.5) < 0.01, `Expected ~0.5, got ${opacity}`);
  });

  it("fades out during last 0.3s", () => {
    const opacity = computeFlashOpacity(5, 8, 7.85); // 0.15s before end
    assert.ok(opacity > 0 && opacity < 1, `Expected partial opacity, got ${opacity}`);
    assert.ok(Math.abs(opacity - 0.5) < 0.01, `Expected ~0.5, got ${opacity}`);
  });

  it("returns ~1 right after fade-in completes", () => {
    const opacity = computeFlashOpacity(5, 8, 5.3);
    assert.ok(opacity > 0.99, `Expected ~1 after fade-in, got ${opacity}`);
  });

  it("returns ~1 right before fade-out starts", () => {
    const opacity = computeFlashOpacity(5, 8, 7.7);
    assert.ok(opacity > 0.99, `Expected ~1 before fade-out, got ${opacity}`);
  });

  it("handles very short flash (< total fade time)", () => {
    // Duration: 0.4s, but fadeIn + fadeOut = 0.6s
    // Scale factor: 0.4 / 0.6 ≈ 0.667
    const opacity = computeFlashOpacity(5, 5.4, 5.2); // midpoint
    assert.ok(opacity >= 0 && opacity <= 1);
  });

  it("returns 0 for invalid inputs", () => {
    assert.equal(computeFlashOpacity(null, 8, 6), 0);
    assert.equal(computeFlashOpacity(5, null, 6), 0);
    assert.equal(computeFlashOpacity(5, 8, null), 0);
  });

  it("returns 0 at exact start time", () => {
    const opacity = computeFlashOpacity(5, 8, 5);
    assert.equal(opacity, 0); // 0 elapsed / 0.3 fadeIn = 0
  });
});

describe("getActiveTermFlash", () => {
  const flashes = [
    { id: 1, start: 2, end: 5, text: "BCAAs", type: "term" },
    { id: 2, start: 8, end: 11, text: "80% failure rate", type: "claim" },
    { id: 3, start: 15, end: 18, text: "Protein denaturation", type: "term" },
  ];

  it("returns active flash with opacity", () => {
    const flash = getActiveTermFlash(flashes, 3.5);
    assert.equal(flash.id, 1);
    assert.equal(flash.text, "BCAAs");
    assert.equal(typeof flash.opacity, "number");
    assert.equal(flash.opacity, 1); // Middle of flash, fully visible
  });

  it("returns null during gap between flashes", () => {
    assert.equal(getActiveTermFlash(flashes, 6), null);
  });

  it("returns null before any flash", () => {
    assert.equal(getActiveTermFlash(flashes, 0), null);
  });

  it("returns null after all flashes", () => {
    assert.equal(getActiveTermFlash(flashes, 20), null);
  });

  it("includes fade-in opacity near start", () => {
    const flash = getActiveTermFlash(flashes, 2.15); // 0.15s into a flash
    assert.ok(flash);
    assert.ok(flash.opacity > 0 && flash.opacity < 1);
  });

  it("handles empty array", () => {
    assert.equal(getActiveTermFlash([], 5), null);
  });

  it("handles null input", () => {
    assert.equal(getActiveTermFlash(null, 5), null);
  });

  it("handles NaN time", () => {
    assert.equal(getActiveTermFlash(flashes, NaN), null);
  });

  it("skips malformed entries", () => {
    const mixed = [
      null,
      { id: 1, start: 2, end: 5, text: "Valid", type: "term" },
      { id: 2, text: "No timing" },
    ];
    const flash = getActiveTermFlash(mixed, 3.5);
    assert.equal(flash.id, 1);
  });

  it("skips entries with start >= end", () => {
    const bad = [
      { id: 1, start: 5, end: 5, text: "Zero duration", type: "term" },
      { id: 2, start: 10, end: 8, text: "Inverted", type: "term" },
      { id: 3, start: 2, end: 5, text: "Valid", type: "term" },
    ];
    const flash = getActiveTermFlash(bad, 3);
    assert.equal(flash.id, 3);
  });
});

describe("checkCaptionCollision", () => {
  it("no collision when flash is in upper area of 1080p", () => {
    assert.equal(checkCaptionCollision("short", 120, 1080), false);
  });

  it("collision when flash is in caption zone", () => {
    assert.equal(checkCaptionCollision("short", 900, 1080), true);
  });

  it("handles longform style", () => {
    assert.equal(checkCaptionCollision("longform", 120, 1080), false);
  });

  it("returns true for invalid inputs", () => {
    assert.equal(checkCaptionCollision("short", null, 1080), true);
    assert.equal(checkCaptionCollision("short", 120, null), true);
    assert.equal(checkCaptionCollision("short", 120, 0), true);
    assert.equal(checkCaptionCollision("short", 120, -100), true);
  });

  it("handles unknown style (defaults to short)", () => {
    assert.equal(checkCaptionCollision("unknown", 120, 1080), false);
  });
});

describe("getSafeFlashPosition", () => {
  it("returns configured position for short style", () => {
    const pos = getSafeFlashPosition("short", 1080);
    assert.equal(pos, TERMFLASH_POSITION.short.top);
  });

  it("returns configured position for longform style", () => {
    const pos = getSafeFlashPosition("longform", 1080);
    assert.equal(pos, TERMFLASH_POSITION.longform.top);
  });

  it("falls back to 40px for very small video height", () => {
    const pos = getSafeFlashPosition("short", 200);
    assert.equal(pos, 40);
  });

  it("handles invalid videoHeight", () => {
    const pos = getSafeFlashPosition("short", null);
    assert.equal(pos, TERMFLASH_POSITION.short.top);
  });

  it("handles zero videoHeight", () => {
    const pos = getSafeFlashPosition("short", 0);
    assert.equal(pos, TERMFLASH_POSITION.short.top);
  });

  it("returns position that does not collide with captions", () => {
    const pos = getSafeFlashPosition("short", 1080);
    assert.equal(checkCaptionCollision("short", pos, 1080), false);
  });
});
