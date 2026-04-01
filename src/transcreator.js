/**
 * Transcreator Module — Phase 4
 *
 * Produces English captions from transcript segments.
 * - English speech: direct passthrough with cleanup
 * - Hindi/Hinglish speech: transcreated to natural English via Claude API
 *
 * Preserves word-level timestamps for Remotion rendering.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Clean up transcript text for caption display.
 * Trims whitespace, normalizes punctuation, ensures sentence casing.
 */
export function cleanCaptionText(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Remove leading/trailing whitespace and normalize internal whitespace
  cleaned = cleaned.replace(/\s+/g, " ");

  // Ensure first character is uppercase
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Add period if no terminal punctuation
  if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}

/**
 * Generate captions directly from English transcript segments.
 * Each transcript segment becomes one caption entry.
 *
 * @param {Array} segments - Transcript segments [{start, end, text, words}]
 * @returns {Array} Caption entries with timing
 */
export function captionsFromEnglish(segments) {
  if (!segments || segments.length === 0) return [];

  return segments.map((seg, index) => ({
    id: index + 1,
    start: seg.start,
    end: seg.end,
    text: cleanCaptionText(seg.text),
    originalText: seg.text,
    words: seg.words || [],
    language: "en",
    transcreated: false,
  }));
}

/**
 * Transcreate Hindi/Hinglish transcript segments to natural English.
 * Uses Claude API to produce natural English that preserves meaning and intent.
 * Processes segments in batches to minimize API calls.
 *
 * @param {Array} segments - Transcript segments [{start, end, text, words}]
 * @param {Object} options - { batchSize, model }
 * @returns {Promise<Array>} Caption entries with transcreated text
 */
export async function transcreateFromHindi(segments, options = {}) {
  if (!segments || segments.length === 0) return [];

  const {
    batchSize = 20,
    model = "claude-sonnet-4-20250514",
  } = options;

  const client = new Anthropic();
  const captions = [];
  let captionId = 1;

  // Process in batches
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);

    const numberedSegments = batch
      .map((seg, idx) => `[${idx + 1}] ${seg.text}`)
      .join("\n");

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Transcreate these Hindi/Hinglish speech segments into natural English. Preserve the meaning, intent, and tone — do NOT do literal translation. Produce fluent English that a native speaker would say.

Return ONLY the transcreated lines in the same numbered format. One line per segment. No explanations.

${numberedSegments}`,
        },
      ],
    });

    const responseText = response.content[0].text;
    const lines = responseText.trim().split("\n");

    for (let j = 0; j < batch.length; j++) {
      const seg = batch[j];
      let transcreatedText = "";

      // Parse numbered response line
      if (j < lines.length) {
        transcreatedText = lines[j].replace(/^\[\d+\]\s*/, "").trim();
      }

      // Fallback to original if parsing failed
      if (!transcreatedText) {
        transcreatedText = seg.text;
      }

      captions.push({
        id: captionId++,
        start: seg.start,
        end: seg.end,
        text: cleanCaptionText(transcreatedText),
        originalText: seg.text,
        words: seg.words || [],
        language: "hi",
        transcreated: true,
      });
    }
  }

  return captions;
}

/**
 * Main entry point: generate captions from a transcript.
 *
 * Detects language and routes to the appropriate handler:
 * - English ("en"): direct passthrough with cleanup
 * - Hindi/Hinglish ("hi"): transcreated via Claude API
 *
 * @param {Object} transcript - { language, segments: [{start, end, text, words}] }
 * @param {Object} options - { batchSize, model }
 * @returns {Promise<Object>} { captions: [...], stats: {...} }
 */
export async function generateCaptions(transcript, options = {}) {
  if (!transcript || !transcript.segments) {
    return {
      captions: [],
      stats: { totalCaptions: 0, transcreatedCount: 0, directCount: 0, language: "unknown" },
    };
  }

  const language = (transcript.language || "en").toLowerCase();
  const isHindi = language === "hi" || language === "hindi";

  let captions;
  if (isHindi) {
    captions = await transcreateFromHindi(transcript.segments, options);
  } else {
    captions = captionsFromEnglish(transcript.segments);
  }

  const transcreatedCount = captions.filter(c => c.transcreated).length;
  const directCount = captions.filter(c => !c.transcreated).length;

  return {
    captions,
    stats: {
      totalCaptions: captions.length,
      transcreatedCount,
      directCount,
      language,
    },
  };
}
