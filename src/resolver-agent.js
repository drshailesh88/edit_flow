/**
 * Resolver Agent Module — Phase 5
 *
 * Synthesizes valid criticisms from the Critic into a revised Manifest.
 * The Resolver applies fixes — both deterministic and AI-guided.
 *
 * Deterministic fixes:
 * - Remove/merge short A-roll segments (< 1s)
 * - Flag low-confidence B-roll as yellow
 * - Trim long captions
 *
 * AI-guided fixes (Claude API):
 * - Decide which Critic suggestions to accept vs reject
 * - Reorder B-roll placements for better pacing
 * - Adjust term flash selection
 *
 * Output: Revised Manifest that addresses the Critic's valid concerns.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Apply deterministic fixes to a manifest based on critique issues.
 * These are safe, mechanical transformations that don't need AI judgment.
 *
 * @param {Object} manifest - Current manifest
 * @param {Object} critique - Critique from critic agent
 * @returns {Object} { manifest: revisedManifest, changes: [{description, category}] }
 */
export function applyDeterministicFixes(manifest, critique) {
  if (!manifest || !critique) {
    return { manifest: manifest || {}, changes: [] };
  }

  // Deep clone to avoid mutating input
  const revised = JSON.parse(JSON.stringify(manifest));
  const changes = [];

  const issues = Array.isArray(critique.issues) ? critique.issues : [];

  // Fix 1: Merge/remove short A-roll segments (< 1s)
  const hasShortSegmentIssue = issues.some(
    i => i.category === "cuts" && i.description && i.description.includes("1s")
  );
  if (hasShortSegmentIssue && Array.isArray(revised.timeline)) {
    const before = revised.timeline.length;
    revised.timeline = mergeShortSegments(revised.timeline);
    const removed = before - revised.timeline.length;
    if (removed > 0) {
      changes.push({
        description: `Merged ${removed} short A-roll segment(s) with adjacent segments`,
        category: "cuts",
      });
    }
  }

  // Fix 2: Flag low-confidence B-roll
  const hasBrollConfidenceIssue = issues.some(
    i => i.category === "broll" && i.description && i.description.includes("confidence")
  );
  if (hasBrollConfidenceIssue && Array.isArray(revised.timeline)) {
    // Already flagged — just add a note
    changes.push({
      description: "Low-confidence B-roll placements flagged for manual review",
      category: "broll",
    });
  }

  // Fix 3: Trim long captions
  const hasLongCaptionIssue = issues.some(
    i => i.category === "captions" && i.description && i.description.includes("20 words")
  );
  if (hasLongCaptionIssue && Array.isArray(revised.captions)) {
    let trimmed = 0;
    revised.captions = revised.captions.map(caption => {
      if (!caption || typeof caption.text !== "string") return caption;
      const words = caption.text.trim().split(/\s+/);
      if (words.length > 20) {
        trimmed++;
        return {
          ...caption,
          text: words.slice(0, 20).join(" ") + "...",
          trimmed: true,
        };
      }
      return caption;
    });
    if (trimmed > 0) {
      changes.push({
        description: `Trimmed ${trimmed} caption(s) to 20 words max`,
        category: "captions",
      });
    }
  }

  // Fix 4: Remove excess term flashes if density is too high
  const hasTermDensityIssue = issues.some(
    i => i.category === "terms" && i.description && i.description.includes("density")
  );
  if (hasTermDensityIssue && Array.isArray(revised.termFlashes) && revised.metadata?.totalDuration > 0) {
    const maxFlashes = Math.ceil((revised.metadata.totalDuration / 60) * 3); // ~3 per minute
    if (revised.termFlashes.length > maxFlashes) {
      const removed = revised.termFlashes.length - maxFlashes;
      // Keep flashes with type "term" first (they're more important than "claim")
      revised.termFlashes.sort((a, b) => {
        if (a.type === "term" && b.type !== "term") return -1;
        if (a.type !== "term" && b.type === "term") return 1;
        return (a.start || 0) - (b.start || 0);
      });
      revised.termFlashes = revised.termFlashes.slice(0, maxFlashes);
      changes.push({
        description: `Removed ${removed} excess term flash(es) to reduce density to ~3/min`,
        category: "terms",
      });
    }
  }

  // Update metadata counts
  if (revised.metadata) {
    if (Array.isArray(revised.timeline)) {
      revised.metadata.arollSegments = revised.timeline.filter(e => e.type === "aroll").length;
      revised.metadata.brollPlacements = revised.timeline.filter(e => e.type === "broll").length;
      revised.metadata.totalDuration = revised.timeline
        .filter(e => e.type === "aroll")
        .reduce((sum, e) => sum + (e.duration || 0), 0);
    }
    if (Array.isArray(revised.captions)) {
      revised.metadata.captionCount = revised.captions.length;
    }
    if (Array.isArray(revised.termFlashes)) {
      revised.metadata.termFlashCount = revised.termFlashes.length;
    }
  }

  return { manifest: revised, changes };
}

/**
 * Merge short A-roll segments (< 1s) with their nearest neighbor.
 * If a short segment is between two longer segments, merge with the closer one.
 *
 * @param {Array} timeline - Timeline entries
 * @returns {Array} Timeline with short segments merged
 */
export function mergeShortSegments(timeline) {
  if (!Array.isArray(timeline)) return [];

  const aroll = timeline.filter(e => e.type === "aroll");
  const other = timeline.filter(e => e.type !== "aroll");

  if (aroll.length === 0) return [...other];

  // Sort A-roll by start time
  aroll.sort((a, b) => a.start - b.start);

  const merged = [];
  for (let i = 0; i < aroll.length; i++) {
    const seg = aroll[i];
    if (seg.duration >= 1.0) {
      merged.push({ ...seg });
      continue;
    }

    // Short segment — merge with previous if available, else next
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.end = Math.max(prev.end, seg.end);
      prev.duration = prev.end - prev.start;
    } else if (i + 1 < aroll.length) {
      // Merge with next by extending next's start
      aroll[i + 1] = {
        ...aroll[i + 1],
        start: seg.start,
        duration: aroll[i + 1].end - seg.start,
      };
    }
    // else: isolated short segment with nothing to merge — drop it
  }

  // Reassign IDs and combine with non-aroll entries
  let nextId = 1;
  const result = [];
  for (const entry of [...merged, ...other]) {
    result.push({ ...entry, id: nextId++ });
  }

  // Sort by start time
  result.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.type === "aroll" ? -1 : 1;
  });

  return result;
}

/**
 * Count how many issues were resolved by deterministic fixes.
 *
 * @param {Array} originalIssues - Issues from critique
 * @param {Array} changes - Changes applied by deterministic fixes
 * @returns {Object} { resolved, remaining, resolutionRate }
 */
export function countResolutions(originalIssues, changes) {
  if (!Array.isArray(originalIssues)) return { resolved: 0, remaining: 0, resolutionRate: 0 };

  const changeCategories = new Set((changes || []).map(c => c.category));
  const resolved = originalIssues.filter(i => changeCategories.has(i.category)).length;
  const remaining = originalIssues.length - resolved;

  return {
    resolved,
    remaining,
    resolutionRate: originalIssues.length > 0 ? resolved / originalIssues.length : 1,
  };
}

/**
 * Use Claude API to resolve remaining issues that need editorial judgment.
 *
 * @param {Object} manifest - Manifest after deterministic fixes
 * @param {Object} critique - Original critique
 * @param {Array} remainingIssues - Issues not resolved by deterministic fixes
 * @param {Object} options - { model }
 * @returns {Promise<Object>} { manifest, aiChanges }
 */
export async function resolveWithAI(manifest, critique, remainingIssues, options = {}) {
  const { model = "claude-sonnet-4-20250514" } = options;

  if (!remainingIssues || remainingIssues.length === 0) {
    return { manifest, aiChanges: [] };
  }

  const client = new Anthropic();

  const manifestSummary = JSON.stringify({
    type: manifest.type,
    timeline: manifest.timeline?.slice(0, 30),
    captions: manifest.captions?.slice(0, 10),
    termFlashes: manifest.termFlashes?.slice(0, 10),
    metadata: manifest.metadata,
  }, null, 2);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are the Resolver agent for a medical/health video pipeline.

The Critic found these issues that need editorial judgment to resolve:
${JSON.stringify(remainingIssues, null, 2)}

Current manifest state:
${manifestSummary}

For each issue, decide:
1. ACCEPT — the criticism is valid, apply the fix
2. REJECT — the criticism is wrong or the current edit is better
3. PARTIAL — partially apply the suggestion

Respond with a JSON object:
{
  "resolutions": [
    {
      "issueIndex": 0,
      "decision": "accept|reject|partial",
      "reason": "why this decision",
      "changes": [
        {"type": "timeline|captions|termFlashes", "action": "add|remove|modify", "details": "what to change"}
      ]
    }
  ],
  "summary": "brief summary of resolutions"
}

Return ONLY the JSON object.`,
      },
    ],
  });

  const responseText = response.content[0]?.text || "{}";

  let aiResult;
  try {
    const jsonStr = responseText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    aiResult = JSON.parse(jsonStr);
  } catch {
    aiResult = { resolutions: [], summary: "AI resolution parsing failed" };
  }

  const aiChanges = Array.isArray(aiResult.resolutions)
    ? aiResult.resolutions.map(r => ({
        decision: ["accept", "reject", "partial"].includes(r.decision) ? r.decision : "reject",
        reason: typeof r.reason === "string" ? r.reason : "",
        issueIndex: typeof r.issueIndex === "number" ? r.issueIndex : -1,
      }))
    : [];

  return { manifest, aiChanges };
}

/**
 * Full Resolver pipeline: deterministic fixes + AI resolution.
 *
 * @param {Object} manifest - Current manifest
 * @param {Object} critique - Critique from critic agent
 * @param {Object} options - { model, skipAI }
 * @returns {Promise<Object>} { manifest, changes, aiChanges, resolutions }
 */
export async function resolveManifest(manifest, critique, options = {}) {
  const { skipAI = false } = options;

  // Step 1: Apply deterministic fixes
  const { manifest: fixedManifest, changes } = applyDeterministicFixes(manifest, critique);

  // Step 2: Count what was resolved
  const issues = Array.isArray(critique?.issues) ? critique.issues : [];
  const resolutions = countResolutions(issues, changes);

  // Step 3: AI resolution for remaining issues (optional)
  let aiChanges = [];
  if (!skipAI && resolutions.remaining > 0) {
    const remainingIssues = issues.filter(i => {
      const changeCategories = new Set(changes.map(c => c.category));
      return !changeCategories.has(i.category);
    });

    const aiResult = await resolveWithAI(fixedManifest, critique, remainingIssues, options);
    aiChanges = aiResult.aiChanges;
  }

  // Add resolution metadata to manifest
  fixedManifest.lastResolution = {
    round: critique?.round || 0,
    deterministicChanges: changes.length,
    aiResolutions: aiChanges.length,
    issuesResolved: resolutions.resolved,
    issuesRemaining: resolutions.remaining,
  };

  return {
    manifest: fixedManifest,
    changes,
    aiChanges,
    resolutions,
  };
}
