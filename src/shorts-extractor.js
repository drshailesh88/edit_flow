/**
 * Shorts Extractor Module — Phase 2
 *
 * Identifies numbered Section boundaries in the Transcript and
 * produces 7-8 standalone Short definitions (one per Section).
 *
 * Each Short contains exactly one complete standalone thought (one Section)
 * and must be <60 seconds.
 *
 * Input: Transcript with segments + best takes from Phase 1
 * Output: Array of Short definitions with time ranges and content
 */

const MAX_SHORT_DURATION = 60; // seconds

/**
 * Detect numbered section boundaries in transcript segments.
 *
 * The creator's scripts use numbered sections (e.g., "1. Introduction",
 * "2. Heavy metals in protein"). These numbers appear in the transcript
 * text when the creator reads them aloud or the section changes topic.
 *
 * Strategy: Use topic/content shifts between consecutive best-take segments
 * to identify natural Section boundaries. Each distinct topic cluster = one Section.
 *
 * Since the creator records in a "keep-rolling" style with re-says,
 * the take selector has already grouped duplicates and picked best takes.
 * The best takes arrive in chronological order. Each best take that covers
 * a distinct topic is a separate Section.
 *
 * @param {Array} bestTakes - [{start, end, text, ...}] from take selection (chronological)
 * @returns {Array} sections - [{id, start, end, text, bestTakes: [...]}]
 */
export function identifySections(bestTakes) {
  if (!bestTakes || bestTakes.length === 0) return [];

  // Each best take is already the winner of its duplicate group.
  // Since duplicates are grouped by text similarity (>60%),
  // each best take represents a unique piece of content = a Section.
  //
  // The simplest and most robust approach: each best take IS a Section.
  // This maps 1:1 with the domain model where each Section = one complete thought.

  const sections = [];
  let sectionIndex = 0;

  for (const take of bestTakes) {
    if (!take || typeof take.start !== "number" || typeof take.end !== "number") continue;
    sectionIndex++;
    sections.push({
      id: sectionIndex,
      start: take.start,
      end: take.end,
      text: take.text || "",
      duration: take.end - take.start,
    });
  }

  return sections;
}

/**
 * Extract Shorts from identified Sections.
 *
 * Each Short = one Section. Validates duration constraint (<60s).
 * Shorts that exceed 60s are flagged for review (Yellow confidence).
 *
 * @param {Array} sections - from identifySections()
 * @param {Object} options - { maxDuration }
 * @returns {Object} { shorts: [...], warnings: [...] }
 */
export function extractShorts(sections, options) {
  const { maxDuration = MAX_SHORT_DURATION } = options || {};

  if (!sections || sections.length === 0) {
    return { shorts: [], warnings: ["No sections found in transcript"] };
  }

  const shorts = [];
  const warnings = [];

  for (const section of sections) {
    const duration = section.end - section.start;

    const short = {
      id: section.id,
      sectionId: section.id,
      start: section.start,
      end: section.end,
      duration,
      text: section.text,
      confidence: duration <= maxDuration ? "green" : "yellow",
    };

    if (duration > maxDuration) {
      const textPreview = section.text ? section.text.slice(0, 50) : "(no text)";
      warnings.push(
        `Short ${section.id} exceeds ${maxDuration}s limit: ${duration.toFixed(1)}s — "${textPreview}..."`
      );
    }

    shorts.push(short);
  }

  return { shorts, warnings };
}

/**
 * Full shorts extraction pipeline.
 *
 * Takes the Phase 1 output (best takes from take selection) and produces
 * Short definitions ready for FFmpeg assembly + auto-reframe.
 *
 * @param {Object} takeResult - { bestTakes, discarded, stats } from selectTakes()
 * @param {Object} options - { maxDuration }
 * @returns {Object} { shorts, sections, warnings, stats }
 */
export function extractShortsFromTakes(takeResult, options) {
  if (!takeResult) return { shorts: [], sections: [], warnings: ["No take result provided"], stats: { totalSections: 0, totalShorts: 0, greenShorts: 0, yellowShorts: 0, totalDuration: 0, avgDuration: 0, longestShort: 0, shortestShort: 0 } };
  const bestTakes = takeResult.bestTakes || [];

  // Step 1: Identify section boundaries
  const sections = identifySections(bestTakes);

  // Step 2: Extract shorts from sections
  const { shorts, warnings } = extractShorts(sections, options);

  // Step 3: Compute stats
  const stats = {
    totalSections: sections.length,
    totalShorts: shorts.length,
    greenShorts: shorts.filter(s => s.confidence === "green").length,
    yellowShorts: shorts.filter(s => s.confidence === "yellow").length,
    totalDuration: shorts.reduce((acc, s) => acc + s.duration, 0),
    avgDuration: shorts.length > 0
      ? shorts.reduce((acc, s) => acc + s.duration, 0) / shorts.length
      : 0,
    longestShort: shorts.length > 0
      ? Math.max(...shorts.map(s => s.duration))
      : 0,
    shortestShort: shorts.length > 0
      ? Math.min(...shorts.map(s => s.duration))
      : 0,
  };

  return { shorts, sections, warnings, stats };
}
