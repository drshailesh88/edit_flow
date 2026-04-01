/**
 * Chapter Title Module — Phase 6
 *
 * Generates Chapter Title cards for Long-form videos.
 * Titles appear between Sections and are derived from numbered script section headings.
 *
 * Chapter Titles only apply to long-form videos (not Shorts).
 */

/**
 * Chapter title display duration in seconds.
 */
export const CHAPTER_TITLE_DURATION = 3;

/**
 * Chapter title style — clean, authoritative, minimal (Huberman/Attia style).
 */
export const CHAPTER_TITLE_STYLE = {
  fontSize: 48,
  fontWeight: 700,
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: "#FFFFFF",
  backgroundColor: "rgba(0, 0, 0, 0.85)",
  paddingVertical: 24,
  paddingHorizontal: 48,
  borderRadius: 8,
  maxWidth: "80%",
  letterSpacing: "-0.02em",
  lineHeight: 1.3,
};

/**
 * Extract chapter titles from identified sections.
 *
 * Each section's text is analyzed to derive a concise chapter title.
 * The creator's scripts use numbered sections (e.g., "1. Heavy metals in protein powder").
 * If a numbered heading is detected, it becomes the chapter title.
 * Otherwise, the first sentence or a truncated version of the text is used.
 *
 * @param {Array} sections - [{id, start, end, text, duration}] from identifySections()
 * @returns {Array} chapterTitles - [{id, start, end, text, sectionId}]
 */
export function extractChapterTitles(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const titles = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || typeof section.start !== "number") continue;

    const titleText = deriveTitle(section.text, section.id);

    // Chapter title appears just before the section starts.
    // For the first section, it starts at 0.
    // For subsequent sections, it appears at the end of the previous section.
    const titleStart = i === 0 ? 0 : sections[i - 1].end;
    const titleEnd = titleStart + CHAPTER_TITLE_DURATION;

    titles.push({
      id: `chapter-${section.id}`,
      sectionId: section.id,
      start: titleStart,
      end: titleEnd,
      text: titleText,
    });
  }

  return titles;
}

/**
 * Derive a chapter title from section text.
 *
 * Strategy:
 * 1. Look for a numbered heading pattern (e.g., "1. Introduction" or "2. Heavy metals")
 * 2. If found, use the heading text (without the number)
 * 3. Otherwise, use the first sentence, truncated to 60 chars
 *
 * @param {string} text - Section text
 * @param {number} sectionId - Section number (fallback)
 * @returns {string} Chapter title
 */
export function deriveTitle(text, sectionId) {
  if (!text || typeof text !== "string") {
    return `Section ${sectionId}`;
  }

  const trimmed = text.trim();

  // Pattern: starts with "N." or "N:" or "N)" followed by a title
  const numberedPattern = /^\s*\d+[\.\:\)]\s*(.+)/;
  const match = trimmed.match(numberedPattern);

  if (match) {
    // Extract just the heading part (first line or up to first period)
    const heading = match[1].split(/[\.!\?]/)[0].trim();
    if (heading.length > 0 && heading.length <= 80) {
      return heading;
    }
    if (heading.length > 80) {
      return heading.slice(0, 77) + "...";
    }
  }

  // No numbered heading — use first sentence
  const firstSentence = trimmed.split(/[\.!\?]/)[0].trim();
  if (firstSentence.length > 0 && firstSentence.length <= 60) {
    return firstSentence;
  }
  if (firstSentence.length > 60) {
    return firstSentence.slice(0, 57) + "...";
  }

  return `Section ${sectionId}`;
}

/**
 * Get the active chapter title at a given time.
 *
 * @param {Array} chapterTitles - [{id, start, end, text}]
 * @param {number} currentTime - Current time in seconds
 * @returns {Object|null} Active chapter title or null
 */
export function getActiveChapterTitle(chapterTitles, currentTime) {
  if (!Array.isArray(chapterTitles) || typeof currentTime !== "number") return null;

  for (const title of chapterTitles) {
    if (currentTime >= title.start && currentTime < title.end) {
      return title;
    }
  }

  return null;
}
