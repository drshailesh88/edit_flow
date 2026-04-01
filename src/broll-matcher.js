/**
 * B-roll Matcher Module — Phase 3
 *
 * Matches B-roll clips from the indexed library to transcript moments
 * by topic relevance using keyword overlap scoring.
 *
 * The matcher works in two modes:
 * - Aggressive (long-form): place B-roll every 15-20 seconds
 * - Selective (shorts): only at topic-relevant moments
 *
 * When no suitable match exists, the moment is flagged Yellow
 * (not filled with irrelevant footage).
 */

import { openDatabase } from "./broll-indexer.js";

/**
 * Extract topic keywords from a transcript segment's text.
 * Filters out common stop words and short words.
 *
 * @param {string} text - Transcript segment text
 * @returns {string[]} Array of meaningful keywords
 */
const DOMAIN_ACRONYMS = new Set([
  "ai", "ct", "mr", "vr", "ar", "3d", "or", "er", "iq", "uv", "ir",
  "iv", "bp", "hr", "rx", "ob", "gp", "gi", "ot", "pt", "rn", "md",
]);

export function extractKeywords(text) {
  if (!text) return [];

  const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "or", "if", "while", "that", "this", "these",
    "those", "what", "which", "who", "whom", "its", "his", "her", "their",
    "our", "your", "my", "it", "he", "she", "they", "we", "you", "me",
    "him", "them", "us", "i", "about", "also", "like", "get", "got",
    "going", "know", "think", "say", "said", "really", "actually",
    "thing", "things", "much", "many", "well", "still", "even", "back",
    "make", "take", "come", "go", "see", "look", "give", "right", "now",
    "new", "old", "good", "bad", "big", "small", "long", "way",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => (w.length > 2 || DOMAIN_ACRONYMS.has(w)) && !STOP_WORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i); // deduplicate
}

/**
 * Score how well a B-roll clip matches a set of topic keywords.
 *
 * Uses a weighted keyword overlap approach:
 * - Exact match in description: high weight
 * - Match in tags: medium weight
 * - Partial match (substring): lower weight
 *
 * @param {object} clip - {description, tags, ...} from the B-roll index
 * @param {string[]} keywords - Topic keywords from transcript
 * @returns {number} Match score (0-1, higher = better match)
 */
export function scoreMatch(clip, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  if (!clip) return 0;

  const desc = (clip.description || "").toLowerCase();
  const tags = (clip.tags || "").toLowerCase();
  const descWords = desc.split(/[\s,:/]+/).filter(Boolean);
  const tagWords = tags.split(",").map(t => t.trim()).filter(Boolean);

  let score = 0;
  let maxPossible = keywords.length;

  for (const keyword of keywords) {
    // Exact word match in description (highest value)
    if (descWords.includes(keyword)) {
      score += 1.0;
      continue;
    }

    // Exact match in tags
    if (tagWords.includes(keyword)) {
      score += 0.8;
      continue;
    }

    // Substring match in description (partial relevance)
    if (desc.includes(keyword)) {
      score += 0.5;
      continue;
    }

    // Substring match in tags
    if (tags.includes(keyword)) {
      score += 0.3;
      continue;
    }
  }

  return maxPossible > 0 ? score / maxPossible : 0;
}

/**
 * Find the best matching B-roll clips for a set of keywords.
 *
 * @param {string} dbPath - Path to B-roll index database
 * @param {string[]} keywords - Topic keywords to match against
 * @param {object} options
 * @param {number} options.minScore - Minimum match score (0-1, default 0.15)
 * @param {number} options.maxResults - Maximum results to return (default 5)
 * @param {Set<number>} options.excludeIds - Clip IDs to exclude (already used)
 * @returns {Array<{clip: object, score: number}>} Ranked matches
 */
export function findMatches(dbPath, keywords, options = {}) {
  const { minScore = 0.15, maxResults = 5, excludeIds = new Set() } = options;

  const db = openDatabase(dbPath);
  try {
    const allClips = db.prepare("SELECT * FROM clips").all();

    const scored = allClips
      .filter(clip => !excludeIds.has(clip.id))
      .map(clip => ({
        clip,
        score: scoreMatch(clip, keywords),
      }))
      .filter(m => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored;
  } finally {
    db.close();
  }
}

/**
 * Identify transcript moments that are candidates for B-roll placement.
 *
 * A "moment" is a window of time in the transcript where the speaker
 * discusses a visual topic that could benefit from B-roll.
 *
 * @param {Array} segments - Transcript segments [{start, end, text}]
 * @param {object} options
 * @param {number} options.windowSize - Seconds per moment window (default 15)
 * @returns {Array<{start: number, end: number, text: string, keywords: string[]}>}
 */
export function identifyMoments(segments, options = {}) {
  const { windowSize = 15 } = options;

  if (!segments || segments.length === 0) return [];

  // Group consecutive segments into time windows
  const moments = [];
  let currentMoment = null;

  for (const seg of segments) {
    if (!currentMoment) {
      currentMoment = {
        start: seg.start,
        end: seg.end,
        texts: [seg.text],
      };
      continue;
    }

    // If this segment fits in the current window, add it
    if (seg.end - currentMoment.start <= windowSize) {
      currentMoment.end = Math.max(currentMoment.end, seg.end);
      currentMoment.texts.push(seg.text);
    } else {
      // Close current moment and start new one
      const text = currentMoment.texts.join(" ");
      moments.push({
        start: currentMoment.start,
        end: currentMoment.end,
        text,
        keywords: extractKeywords(text),
      });
      currentMoment = {
        start: seg.start,
        end: seg.end,
        texts: [seg.text],
      };
    }
  }

  // Don't forget the last moment
  if (currentMoment) {
    const text = currentMoment.texts.join(" ");
    moments.push({
      start: currentMoment.start,
      end: currentMoment.end,
      text,
      keywords: extractKeywords(text),
    });
  }

  return moments;
}

/**
 * Match B-roll clips to transcript moments.
 *
 * This is the main entry point for B-roll matching. It:
 * 1. Identifies moments in the transcript
 * 2. Finds the best B-roll match for each moment
 * 3. Returns a placement plan with confidence levels
 *
 * @param {Array} segments - Transcript segments [{start, end, text}]
 * @param {string} dbPath - Path to B-roll index database
 * @param {object} options
 * @param {string} options.mode - "aggressive" (every 15-20s) or "selective" (topic-relevant only)
 * @param {number} options.minScore - Minimum match score for placement
 * @param {number} options.brollDuration - Duration of B-roll insert in seconds (default 5)
 * @returns {{placements: Array, stats: object}}
 */
export function matchBroll(segments, dbPath, options = {}) {
  const {
    mode = "aggressive",
    minScore = 0.15,
    brollDuration = 5,
  } = options;

  const windowSize = mode === "aggressive" ? 15 : 30;
  const moments = identifyMoments(segments, { windowSize });

  const placements = [];
  const usedClipIds = new Set();
  let yellowCount = 0;

  for (const moment of moments) {
    // Skip moments with no meaningful keywords
    if (moment.keywords.length === 0) {
      if (mode === "aggressive") {
        // In aggressive mode, flag as yellow (no keywords to match)
        placements.push({
          timestamp: moment.start + (moment.end - moment.start) / 2,
          duration: brollDuration,
          clip: null,
          score: 0,
          confidence: "yellow",
          reason: "no-keywords",
          momentText: moment.text.slice(0, 100),
        });
        yellowCount++;
      }
      continue;
    }

    const matches = findMatches(dbPath, moment.keywords, {
      minScore,
      maxResults: 3,
      excludeIds: usedClipIds,
    });

    if (matches.length > 0) {
      const best = matches[0];
      usedClipIds.add(best.clip.id);

      placements.push({
        timestamp: moment.start + (moment.end - moment.start) / 2,
        duration: Math.min(brollDuration, best.clip.duration || brollDuration),
        clip: {
          id: best.clip.id,
          filePath: best.clip.file_path,
          filename: best.clip.filename,
          description: best.clip.description,
        },
        score: Math.round(best.score * 100) / 100,
        confidence: best.score >= 0.4 ? "green" : "yellow",
        reason: best.score >= 0.4 ? "good-match" : "weak-match",
        momentText: moment.text.slice(0, 100),
      });

      if (best.score < 0.4) yellowCount++;
    } else {
      // No match found — flag Yellow per requirements
      placements.push({
        timestamp: moment.start + (moment.end - moment.start) / 2,
        duration: brollDuration,
        clip: null,
        score: 0,
        confidence: "yellow",
        reason: "no-match",
        momentText: moment.text.slice(0, 100),
      });
      yellowCount++;
    }
  }

  return {
    placements,
    stats: {
      totalMoments: moments.length,
      totalPlacements: placements.length,
      greenPlacements: placements.filter(p => p.confidence === "green").length,
      yellowPlacements: yellowCount,
      uniqueClipsUsed: usedClipIds.size,
      mode,
    },
  };
}
