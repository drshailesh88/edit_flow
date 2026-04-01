/**
 * Term Flash Configuration — Pure data and logic for term flash overlay
 *
 * Separated from React components so it can be imported in Node.js tests.
 *
 * Term Flash styling per PRD:
 * - Clean sans-serif font
 * - White text on semi-transparent dark background
 * - Fade in/out 0.3s, hold 2-4 seconds
 * - Positioned to avoid collision with captions (upper area of screen)
 */

/**
 * Term flash visual style
 */
export const TERMFLASH_STYLE = {
  color: "#FFFFFF",
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  fontSize: 36,
  fontWeight: 600,
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  paddingVertical: 12,
  paddingHorizontal: 28,
  borderRadius: 8,
  fadeInDuration: 0.3, // seconds
  fadeOutDuration: 0.3, // seconds
  maxWidth: "60%",
  letterSpacing: "0.02em",
};

/**
 * Term flash positioning.
 * Captions occupy the lower portion of screen.
 * Term flashes are positioned in the upper third to avoid collision.
 */
export const TERMFLASH_POSITION = {
  // For short videos (captions at lower third ~180px from bottom):
  // Term flash goes in upper third
  short: {
    top: 120,
    alignment: "center",
  },
  // For longform videos (captions at bottom ~60px from bottom):
  // Term flash goes in upper quarter
  longform: {
    top: 80,
    alignment: "center",
  },
};

/**
 * Get the active term flash for a given time.
 * Unlike captions which display continuously, term flashes include
 * fade timing: the visible window includes fade-in and fade-out periods.
 *
 * @param {Array} termFlashes - Term flash entries [{id, start, end, text, type}]
 * @param {number} currentTime - Current time in seconds
 * @returns {Object|null} Active term flash with opacity, or null
 */
export function getActiveTermFlash(termFlashes, currentTime) {
  if (!Array.isArray(termFlashes) || typeof currentTime !== "number" || isNaN(currentTime)) {
    return null;
  }

  for (const flash of termFlashes) {
    if (!flash || typeof flash.start !== "number" || typeof flash.end !== "number") continue;
    if (flash.start >= flash.end) continue;

    if (currentTime >= flash.start && currentTime < flash.end) {
      const opacity = computeFlashOpacity(flash.start, flash.end, currentTime);
      return { ...flash, opacity };
    }
  }

  return null;
}

/**
 * Compute opacity for a term flash at a given time.
 * Implements fade-in (0.3s) and fade-out (0.3s) transitions.
 *
 * @param {number} start - Flash start time
 * @param {number} end - Flash end time
 * @param {number} currentTime - Current time
 * @returns {number} Opacity 0-1
 */
export function computeFlashOpacity(start, end, currentTime) {
  if (typeof start !== "number" || typeof end !== "number" || typeof currentTime !== "number") {
    return 0;
  }
  if (isNaN(start) || isNaN(end) || isNaN(currentTime)) return 0;

  const fadeIn = TERMFLASH_STYLE.fadeInDuration;
  const fadeOut = TERMFLASH_STYLE.fadeOutDuration;
  const duration = end - start;

  if (duration <= 0) return 0;

  // If duration is too short for both fades, scale them proportionally
  const totalFade = fadeIn + fadeOut;
  const scale = duration < totalFade ? duration / totalFade : 1;
  const actualFadeIn = fadeIn * scale;
  const actualFadeOut = fadeOut * scale;

  const elapsed = currentTime - start;
  const remaining = end - currentTime;

  if (elapsed < 0 || remaining < 0) return 0;

  // Fade in
  if (elapsed < actualFadeIn) {
    return elapsed / actualFadeIn;
  }

  // Fade out
  if (remaining < actualFadeOut) {
    return remaining / actualFadeOut;
  }

  // Fully visible
  return 1;
}

/**
 * Check if a term flash collides with the caption area.
 * Returns true if the term flash position would overlap with captions.
 *
 * @param {string} captionStyle - "short" or "longform"
 * @param {number} flashTopPosition - Top position of term flash
 * @param {number} videoHeight - Video height in pixels
 * @returns {boolean} True if collision detected
 */
export function checkCaptionCollision(captionStyle, flashTopPosition, videoHeight) {
  if (typeof flashTopPosition !== "number" || typeof videoHeight !== "number") return true;
  if (isNaN(flashTopPosition) || isNaN(videoHeight)) return true;
  if (videoHeight <= 0) return true;

  // Caption zones (approximate, including padding):
  // Short: bottom 180px + ~80px text height = bottom 260px
  // Longform: bottom 60px + ~60px text height = bottom 120px
  const captionZones = {
    short: 260,
    longform: 120,
  };

  const captionZone = captionZones[captionStyle] || captionZones.short;
  const captionTop = videoHeight - captionZone;

  // Term flash is ~60px tall (fontSize 36 + padding 24)
  const flashHeight = TERMFLASH_STYLE.fontSize + TERMFLASH_STYLE.paddingVertical * 2;
  const flashBottom = flashTopPosition + flashHeight;

  return flashBottom > captionTop;
}

/**
 * Get safe position for a term flash that avoids caption collision.
 *
 * @param {string} captionStyle - "short" or "longform"
 * @param {number} videoHeight - Video height in pixels
 * @returns {number} Safe top position in pixels
 */
export function getSafeFlashPosition(captionStyle, videoHeight) {
  if (typeof videoHeight !== "number" || isNaN(videoHeight) || videoHeight <= 0) {
    return TERMFLASH_POSITION.short.top;
  }

  const pos = TERMFLASH_POSITION[captionStyle] || TERMFLASH_POSITION.short;

  // Verify no collision; if collision, move up
  if (checkCaptionCollision(captionStyle, pos.top, videoHeight)) {
    // Move to very top with some padding
    return 40;
  }

  return pos.top;
}
