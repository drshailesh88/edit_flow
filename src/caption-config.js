/**
 * Caption Configuration — Pure data and logic for caption overlay
 *
 * Separated from React components so it can be imported in Node.js tests
 * and in Remotion JSX components.
 *
 * Two presets: "white-on-black" and "black-on-white"
 * Two styles: "short" (lower third, moderate size) and "longform" (smaller, bottom)
 */

/**
 * Caption preset styles (color schemes)
 */
export const CAPTION_PRESETS = {
  "white-on-black": {
    color: "#FFFFFF",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    name: "White on Black",
  },
  "black-on-white": {
    color: "#000000",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    name: "Black on White",
  },
};

/**
 * Caption style configurations for short vs longform videos
 */
export const CAPTION_STYLES = {
  short: {
    fontSize: 48,
    lineHeight: 1.3,
    paddingVertical: 16,
    paddingHorizontal: 32,
    bottomOffset: 180, // lower third positioning
    maxWidth: "85%",
    borderRadius: 8,
    fontWeight: 600,
  },
  longform: {
    fontSize: 32,
    lineHeight: 1.25,
    paddingVertical: 10,
    paddingHorizontal: 24,
    bottomOffset: 60, // bottom of screen
    maxWidth: "75%",
    borderRadius: 6,
    fontWeight: 500,
  },
};

/**
 * Get the active caption for a given time.
 *
 * @param {Array} captions - Caption entries [{id, start, end, text}]
 * @param {number} currentTime - Current time in seconds
 * @returns {Object|null} Active caption or null
 */
export function getActiveCaption(captions, currentTime) {
  if (!Array.isArray(captions) || typeof currentTime !== "number" || isNaN(currentTime)) {
    return null;
  }

  return captions.find(
    cap => cap && typeof cap.start === "number" && typeof cap.end === "number" &&
           currentTime >= cap.start && currentTime < cap.end
  ) || null;
}
