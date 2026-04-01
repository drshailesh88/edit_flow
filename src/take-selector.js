/**
 * Take Selector Module
 *
 * Analyzes a Whisper transcript to detect bad takes and select best takes
 * when multiple versions of the same content exist.
 *
 * Bad take signals (from grill session):
 * - Incomplete sentences (trailing off, no proper ending)
 * - Short fragments (false starts)
 * - Stumbling (large word-to-word gaps indicating hesitation)
 * - Repeated content (same sentence said multiple times)
 *
 * When duplicates exist, selects the shorter, more fluent, more confident version.
 */

/**
 * Detect bad takes from transcript segments.
 * Returns each segment annotated with badTake info.
 *
 * @param {Array} segments - Whisper transcript segments [{start, end, text, words}]
 * @returns {Array} Annotated segments with { ...segment, analysis: { isBadTake, reasons, fluencyScore } }
 */
export function analyzeTakes(segments) {
  return segments.map((segment) => {
    const reasons = [];
    let fluencyScore = 100; // Start perfect, deduct for issues

    const text = segment.text.trim();
    const words = segment.words || [];

    // 1. Fragment detection: very short segments (< 4 words)
    if (words.length < 4) {
      reasons.push("fragment");
      fluencyScore -= 40;
    }

    // 2. Incomplete sentence: no terminal punctuation
    if (text.length > 0 && !/[.!?]$/.test(text)) {
      reasons.push("incomplete");
      fluencyScore -= 30;
    }

    // 3. Trailing off: sentence ends with "..." or has no conclusion
    if (/\.\.\.$/.test(text) || /[,;]$/.test(text)) {
      reasons.push("trailing-off");
      fluencyScore -= 25;
    }

    // 4. Hesitation/stumbling: large gaps between consecutive words
    const hesitations = detectHesitations(words);
    if (hesitations.count > 0) {
      reasons.push("hesitation");
      // Deduct more for more hesitations
      fluencyScore -= Math.min(30, hesitations.count * 10);
    }

    // 5. Pace irregularity: words per second variance
    const pace = computePace(words);
    if (pace.varianceRatio > 3.0 && words.length > 4) {
      reasons.push("irregular-pace");
      fluencyScore -= 15;
    }

    // Clamp score
    fluencyScore = Math.max(0, Math.min(100, fluencyScore));

    const isBadTake = fluencyScore < 50 || reasons.includes("fragment") || reasons.includes("incomplete");

    return {
      ...segment,
      analysis: {
        isBadTake,
        reasons,
        fluencyScore,
        hesitations: hesitations.gaps,
        wordsPerSecond: pace.wps,
      },
    };
  });
}

/**
 * Detect hesitation gaps between consecutive words.
 * A gap > 2 seconds between words in the same segment indicates stumbling.
 *
 * @param {Array} words - [{word, start, end}]
 * @returns {{ count: number, gaps: Array<{after: string, gapSeconds: number}> }}
 */
export function detectHesitations(words, gapThreshold = 2.0) {
  const gaps = [];

  for (let i = 0; i < words.length - 1; i++) {
    const currentEnd = words[i].end;
    const nextStart = words[i + 1].start;
    const gap = nextStart - currentEnd;

    if (gap > gapThreshold) {
      gaps.push({
        after: words[i].word,
        before: words[i + 1].word,
        gapSeconds: Math.round(gap * 100) / 100,
      });
    }
  }

  return { count: gaps.length, gaps };
}

/**
 * Compute speaking pace metrics.
 *
 * @param {Array} words - [{word, start, end}]
 * @returns {{ wps: number, varianceRatio: number }}
 */
export function computePace(words) {
  if (words.length < 2) {
    return { wps: 0, varianceRatio: 0 };
  }

  const totalDuration = words[words.length - 1].end - words[0].start;
  const wps = totalDuration > 0 ? words.length / totalDuration : 0;

  // Compute per-word durations and find variance
  const durations = [];
  for (let i = 0; i < words.length - 1; i++) {
    const dur = words[i + 1].start - words[i].start;
    if (dur > 0) durations.push(dur);
  }

  if (durations.length < 2) {
    return { wps, varianceRatio: 0 };
  }

  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((a, d) => a + (d - mean) ** 2, 0) / durations.length;
  const varianceRatio = mean > 0 ? Math.sqrt(variance) / mean : 0;

  return { wps: Math.round(wps * 100) / 100, varianceRatio: Math.round(varianceRatio * 100) / 100 };
}

/**
 * Group segments that contain similar/duplicate content.
 * Uses normalized text similarity to find repeated takes of the same line.
 *
 * @param {Array} analyzedSegments - Output from analyzeTakes()
 * @param {number} similarityThreshold - 0-1, how similar texts must be to group (default 0.6)
 * @returns {Array<Array>} Groups of similar segments
 */
export function groupDuplicateTakes(analyzedSegments, similarityThreshold = 0.6) {
  const used = new Set();
  const groups = [];

  for (let i = 0; i < analyzedSegments.length; i++) {
    if (used.has(i)) continue;

    const group = [analyzedSegments[i]];
    used.add(i);

    for (let j = i + 1; j < analyzedSegments.length; j++) {
      if (used.has(j)) continue;

      const sim = textSimilarity(
        analyzedSegments[i].text,
        analyzedSegments[j].text
      );

      if (sim >= similarityThreshold) {
        group.push(analyzedSegments[j]);
        used.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Normalized text similarity using word overlap (Jaccard-like).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 similarity score
 */
export function textSimilarity(a, b) {
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

  const wordsA = normalize(a);
  const wordsB = normalize(b);

  if (wordsA.length === 0 && wordsB.length === 0) return 1;
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Detect truncated takes within a group.
 * If segment A's normalized words are a prefix of segment B's words,
 * A is a truncated (abandoned) version and B is the complete take.
 *
 * @param {Array} group - Group of similar segments
 */
function markTruncatedTakes(group) {
  const normalize = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

  for (let i = 0; i < group.length; i++) {
    const wordsI = normalize(group[i].text);

    for (let j = 0; j < group.length; j++) {
      if (i === j) continue;
      const wordsJ = normalize(group[j].text);

      // Check if i's words are a prefix of j's words (i is truncated version of j)
      if (wordsI.length < wordsJ.length && wordsI.length >= 3) {
        const isPrefix = wordsI.every((w, idx) => wordsJ[idx] === w);
        if (isPrefix) {
          if (!group[i].analysis.reasons.includes("truncated")) {
            group[i].analysis.reasons.push("truncated");
            group[i].analysis.fluencyScore = Math.max(0, group[i].analysis.fluencyScore - 20);
            group[i].analysis.isBadTake = true;
          }
        }
      }
    }
  }
}

/**
 * From grouped duplicate takes, select the best take in each group.
 *
 * Selection criteria (from grill session):
 * 1. Must be a complete sentence (not a fragment or incomplete)
 * 2. Higher fluency score preferred
 * 3. Among complete takes, prefer shorter duration (more confident delivery)
 * 4. Among similar duration, prefer fewer hesitations
 *
 * @param {Array<Array>} groups - Output from groupDuplicateTakes()
 * @returns {{ bestTakes: Array, discarded: Array }}
 */
export function selectBestTakes(groups) {
  const bestTakes = [];
  const discarded = [];

  for (const group of groups) {
    if (group.length === 1) {
      // Solo segment — discard if it's a fragment (false start) or truly terrible
      const isFragment = group[0].analysis.reasons.includes("fragment");
      const isTerrible = group[0].analysis.isBadTake && group[0].analysis.fluencyScore < 30;

      if (isFragment || isTerrible) {
        discarded.push({ ...group[0], discardReason: "bad-take-no-alternative" });
      } else {
        bestTakes.push(group[0]);
      }
      continue;
    }

    // Multiple takes — sort by quality
    // First, detect truncated takes (one is a prefix of another)
    markTruncatedTakes(group);

    const ranked = [...group].sort((a, b) => {
      // Non-truncated first
      const aTruncated = a.analysis.reasons.includes("truncated");
      const bTruncated = b.analysis.reasons.includes("truncated");
      if (aTruncated !== bTruncated) return aTruncated ? 1 : -1;

      // Complete sentences first
      const aComplete = !a.analysis.reasons.includes("incomplete") && !a.analysis.reasons.includes("fragment");
      const bComplete = !b.analysis.reasons.includes("incomplete") && !b.analysis.reasons.includes("fragment");

      if (aComplete !== bComplete) return bComplete ? 1 : -1;

      // Higher fluency score
      if (a.analysis.fluencyScore !== b.analysis.fluencyScore) {
        return b.analysis.fluencyScore - a.analysis.fluencyScore;
      }

      // Shorter duration (more confident delivery), but only if word count is similar
      const aWords = (a.words || []).length;
      const bWords = (b.words || []).length;

      // If one has significantly more content words, prefer it (it's more complete)
      if (Math.abs(aWords - bWords) > 2) {
        return bWords - aWords;
      }

      // Among similar content length, prefer shorter duration (more confident)
      const aDur = a.end - a.start;
      const bDur = b.end - b.start;
      return aDur - bDur;
    });

    bestTakes.push(ranked[0]);
    for (let i = 1; i < ranked.length; i++) {
      discarded.push({ ...ranked[i], discardReason: "worse-duplicate" });
    }
  }

  // Sort best takes by start time
  bestTakes.sort((a, b) => a.start - b.start);

  return { bestTakes, discarded };
}

/**
 * Full take selection pipeline:
 * 1. Analyze all segments for bad take signals
 * 2. Group duplicate/similar segments
 * 3. Select best take from each group
 * 4. Return selected segments as speaking timeline
 *
 * @param {object} transcript - Whisper transcript {segments: [{start, end, text, words}]}
 * @returns {{ bestTakes: Array, discarded: Array, stats: object }}
 */
export function selectTakes(transcript) {
  const analyzed = analyzeTakes(transcript.segments);
  const groups = groupDuplicateTakes(analyzed);
  const { bestTakes, discarded } = selectBestTakes(groups);

  return {
    bestTakes,
    discarded,
    stats: {
      totalSegments: transcript.segments.length,
      groups: groups.length,
      kept: bestTakes.length,
      discarded: discarded.length,
      badTakes: analyzed.filter((s) => s.analysis.isBadTake).length,
    },
  };
}
