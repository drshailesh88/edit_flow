/**
 * Term Identifier Module — Phase 4
 *
 * Identifies technical/medical terms and key claims from transcript segments.
 * Returns term flash entries with timing for Remotion rendering.
 *
 * Two categories:
 * - "term": Technical and operative medical terms (e.g., "protein denaturation", "BCAAs")
 * - "claim": Key claims and statistics worth emphasizing (e.g., "80% of supplements fail testing")
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Extract terms and claims from transcript segments using Claude API.
 * Processes in batches to handle long transcripts efficiently.
 *
 * @param {Array} segments - Transcript segments [{start, end, text, words}]
 * @param {Object} options - { batchSize, model, maxTermsPerBatch }
 * @returns {Promise<Array>} Term flash entries
 */
export async function identifyTerms(segments, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const {
    batchSize = 30,
    model = "claude-sonnet-4-20250514",
    maxTermsPerBatch = 20,
  } = options;

  const client = new Anthropic();
  const termFlashes = [];
  let flashId = 1;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);

    const segmentText = batch
      .map((seg, idx) => `[${idx + 1}] (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s) ${seg.text}`)
      .join("\n");

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Analyze these transcript segments from a medical/health video. Identify:

1. **Technical/medical terms**: scientific names, medical procedures, biochemistry terms, drug names, anatomical terms
2. **Key claims/statistics**: specific numbers, percentages, study findings, bold factual claims worth emphasizing

For each item, return a JSON array. Each entry:
{
  "segmentIndex": <1-based index of the segment>,
  "text": "<the term or claim to display>",
  "type": "term" or "claim",
  "startWord": "<first word of the term in the segment text>"
}

Return ONLY the JSON array. No explanation. If nothing found, return [].
Maximum ${maxTermsPerBatch} items per batch.

Segments:
${segmentText}`,
        },
      ],
    });

    const responseText = response.content[0].text.trim();
    const items = parseTermResponse(responseText);

    for (const item of items) {
      const segIdx = item.segmentIndex - 1;
      if (segIdx < 0 || segIdx >= batch.length) continue;

      const seg = batch[segIdx];
      const timing = resolveTermTiming(seg, item.startWord, item.text);

      termFlashes.push({
        id: flashId++,
        start: timing.start,
        end: timing.end,
        text: item.text,
        type: item.type === "claim" ? "claim" : "term",
        segmentStart: seg.start,
        segmentEnd: seg.end,
      });
    }
  }

  return termFlashes;
}

/**
 * Parse the JSON response from Claude, handling common formatting issues.
 *
 * @param {string} responseText - Raw response text
 * @returns {Array} Parsed items
 */
export function parseTermResponse(responseText) {
  if (!responseText || typeof responseText !== "string") return [];

  let text = responseText.trim();

  // Strip markdown code fences if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      item =>
        item &&
        typeof item.segmentIndex === "number" &&
        typeof item.text === "string" &&
        item.text.trim().length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Resolve timing for a term flash within a segment.
 * Uses word-level timestamps when available, falls back to segment timing.
 *
 * @param {Object} segment - { start, end, text, words }
 * @param {string} startWord - First word of the term
 * @param {string} termText - Full term text
 * @returns {Object} { start, end } timestamps for the flash
 */
export function resolveTermTiming(segment, startWord, termText) {
  const defaultDuration = 3; // seconds

  if (!segment || typeof segment.start !== "number") {
    return { start: 0, end: defaultDuration };
  }

  // Try to find the start word in word-level timestamps
  if (Array.isArray(segment.words) && segment.words.length > 0 && startWord) {
    const normalizedStart = startWord.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wordIdx = segment.words.findIndex(
      w => w.word && w.word.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedStart
    );

    if (wordIdx >= 0) {
      const wordStart = segment.words[wordIdx].start;
      // Term flash appears slightly before the word and holds for 2-4s
      const flashStart = Math.max(segment.start, wordStart - 0.2);
      const flashEnd = Math.min(segment.end, flashStart + defaultDuration);
      return { start: flashStart, end: flashEnd };
    }
  }

  // Fallback: center the flash within the segment
  const segDuration = segment.end - segment.start;
  if (segDuration <= defaultDuration) {
    return { start: segment.start, end: segment.end };
  }

  const flashStart = segment.start + (segDuration - defaultDuration) / 2;
  return { start: flashStart, end: flashStart + defaultDuration };
}

/**
 * Main entry point: identify terms and claims from a transcript.
 *
 * @param {Object} transcript - { language, segments: [{start, end, text, words}] }
 * @param {Object} options - { batchSize, model, maxTermsPerBatch }
 * @returns {Promise<Object>} { termFlashes: [...], stats: {...} }
 */
export async function extractTermFlashes(transcript, options = {}) {
  if (!transcript || !Array.isArray(transcript.segments)) {
    return {
      termFlashes: [],
      stats: { totalFlashes: 0, terms: 0, claims: 0 },
    };
  }

  const termFlashes = await identifyTerms(transcript.segments, options);

  const terms = termFlashes.filter(t => t.type === "term").length;
  const claims = termFlashes.filter(t => t.type === "claim").length;

  return {
    termFlashes,
    stats: {
      totalFlashes: termFlashes.length,
      terms,
      claims,
    },
  };
}
