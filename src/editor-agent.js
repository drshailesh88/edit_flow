/**
 * Editor Agent Module — Phase 5
 *
 * Generates an initial Manifest from Transcript + B-roll Index + pipeline outputs.
 * The Manifest is a unified JSON containing ALL editorial decisions:
 * - A-roll segments (cut points from take selection)
 * - B-roll placements (from B-roll matcher/placer)
 * - Captions (from transcreator)
 * - Term flashes (from term identifier)
 *
 * The Editor uses Claude API to make holistic editorial judgments:
 * - Verify B-roll placement makes sense in context
 * - Ensure term flashes don't overlap captions
 * - Check pacing and rhythm of cuts
 * - Flag any editorial concerns
 *
 * Output: Manifest JSON consumed by Critic agent for adversarial review.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Manifest schema version. Increment when format changes.
 */
export const MANIFEST_VERSION = 1;

/**
 * Build a timeline from A-roll segments and B-roll placements.
 * B-roll insertions split/overlay A-roll segments at their timestamp positions.
 *
 * @param {Array} arollSegments - [{start, end}] final speaking segments
 * @param {Array} brollPlacements - [{insertAt, duration, clipPath, ...}] from B-roll placer
 * @returns {Array} Timeline entries [{id, type, start, end, source, ...}]
 */
export function buildTimeline(arollSegments, brollPlacements = []) {
  if (!Array.isArray(arollSegments) || arollSegments.length === 0) return [];

  const timeline = [];
  let timelineId = 1;

  // Create A-roll entries
  for (const seg of arollSegments) {
    if (typeof seg.start !== "number" || typeof seg.end !== "number") continue;
    if (seg.end <= seg.start) continue;

    timeline.push({
      id: timelineId++,
      type: "aroll",
      start: seg.start,
      end: seg.end,
      duration: seg.end - seg.start,
    });
  }

  // Insert B-roll placements as overlay entries
  if (Array.isArray(brollPlacements)) {
    for (const placement of brollPlacements) {
      if (!placement || typeof placement.insertAt !== "number") continue;

      const duration = placement.duration || 5;
      timeline.push({
        id: timelineId++,
        type: "broll",
        start: placement.insertAt,
        end: placement.insertAt + duration,
        duration,
        source: placement.clipPath || placement.clip_path || null,
        clipName: placement.clipName || placement.clip_name || null,
        confidence: placement.confidence || "green",
        matchScore: placement.matchScore || placement.score || 0,
      });
    }
  }

  // Sort by start time, A-roll first at same time
  timeline.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.type === "aroll" ? -1 : 1;
  });

  return timeline;
}

/**
 * Assemble a Manifest from pipeline outputs.
 * This is the deterministic assembly step — no AI calls.
 *
 * @param {Object} params
 * @param {string} params.recordingName - Name of the recording
 * @param {string} params.type - "longform" or "short"
 * @param {Array} params.segments - Final A-roll segments [{start, end}]
 * @param {Array} params.brollPlacements - B-roll placement manifest [{insertAt, duration, clipPath, ...}]
 * @param {Array} params.captions - Caption entries [{start, end, text, preset, ...}]
 * @param {Array} params.termFlashes - Term flash entries [{start, end, text, type, ...}]
 * @param {Object} params.transcript - Original transcript {segments, language}
 * @param {Object} params.takeSelection - Take selection stats {bestTakes, discarded, stats}
 * @returns {Object} Manifest JSON
 */
export function assembleManifest({
  recordingName,
  type = "longform",
  segments = [],
  brollPlacements = [],
  captions = [],
  termFlashes = [],
  transcript = null,
  takeSelection = null,
}) {
  const timeline = buildTimeline(segments, brollPlacements);

  const arollEntries = timeline.filter(e => e.type === "aroll");
  const brollEntries = timeline.filter(e => e.type === "broll");
  const totalDuration = arollEntries.length > 0
    ? Math.max(...arollEntries.map(e => e.end)) - Math.min(...arollEntries.map(e => e.start))
    : 0;

  // Detect potential issues for editorial review
  const flags = detectEditorialFlags({
    timeline,
    captions,
    termFlashes,
    totalDuration,
    type,
  });

  return {
    version: MANIFEST_VERSION,
    recordingName: recordingName || "unknown",
    type,
    timeline,
    captions: Array.isArray(captions) ? captions : [],
    termFlashes: Array.isArray(termFlashes) ? termFlashes : [],
    metadata: {
      totalDuration,
      arollSegments: arollEntries.length,
      brollPlacements: brollEntries.length,
      captionCount: Array.isArray(captions) ? captions.length : 0,
      termFlashCount: Array.isArray(termFlashes) ? termFlashes.length : 0,
      transcriptLanguage: transcript?.language || "unknown",
      takeStats: takeSelection?.stats || null,
    },
    flags,
    editorialNotes: [],
  };
}

/**
 * Detect editorial flags — issues the Critic should focus on.
 *
 * @param {Object} params
 * @returns {Array} Flag entries [{severity, category, message, timestamp}]
 */
export function detectEditorialFlags({ timeline, captions, termFlashes, totalDuration, type }) {
  const flags = [];

  if (!timeline || timeline.length === 0) {
    flags.push({
      severity: "red",
      category: "timeline",
      message: "Empty timeline — no segments to render",
    });
    return flags;
  }

  // Check B-roll density for longform
  const brollEntries = timeline.filter(e => e.type === "broll");
  const arollEntries = timeline.filter(e => e.type === "aroll");

  if (type === "longform" && totalDuration > 60) {
    const expectedBroll = Math.floor(totalDuration / 20); // every ~20s
    if (brollEntries.length < expectedBroll * 0.5) {
      flags.push({
        severity: "yellow",
        category: "broll-density",
        message: `Low B-roll density for longform: ${brollEntries.length} placements for ${totalDuration.toFixed(0)}s video (expected ~${expectedBroll})`,
      });
    }
  }

  // Check for B-roll with low confidence
  const yellowBroll = brollEntries.filter(e => e.confidence === "yellow");
  if (yellowBroll.length > 0) {
    flags.push({
      severity: "yellow",
      category: "broll-confidence",
      message: `${yellowBroll.length} B-roll placement(s) with low match confidence`,
    });
  }

  // Check for term flash / caption overlap
  if (Array.isArray(captions) && Array.isArray(termFlashes)) {
    for (const flash of termFlashes) {
      if (!flash || typeof flash.start !== "number") continue;
      const overlapping = captions.filter(
        c => c && typeof c.start === "number" && typeof c.end === "number" &&
             flash.start < c.end && flash.end > c.start
      );
      // Overlaps are expected (term flash appears during caption), but flag if many
    }
  }

  // Check for very short segments (< 0.5s)
  const shortSegments = arollEntries.filter(e => e.duration < 0.5);
  if (shortSegments.length > 0) {
    flags.push({
      severity: "yellow",
      category: "short-segments",
      message: `${shortSegments.length} A-roll segment(s) shorter than 0.5s — may cause jump cuts`,
    });
  }

  // Check for large gaps between A-roll segments (> 2s without B-roll)
  for (let i = 1; i < arollEntries.length; i++) {
    const gap = arollEntries[i].start - arollEntries[i - 1].end;
    if (gap > 2) {
      const hasBrollInGap = brollEntries.some(
        b => b.start >= arollEntries[i - 1].end && b.end <= arollEntries[i].start
      );
      if (!hasBrollInGap) {
        flags.push({
          severity: "yellow",
          category: "gap",
          message: `${gap.toFixed(1)}s gap between A-roll segments at ${arollEntries[i - 1].end.toFixed(1)}s — no B-roll coverage`,
        });
      }
    }
  }

  return flags;
}

/**
 * Use Claude API to review and enhance the assembled Manifest.
 * The Editor agent examines the manifest holistically and adds editorial notes,
 * adjusts B-roll placements, and flags issues for the Critic.
 *
 * @param {Object} manifest - Assembled manifest from assembleManifest()
 * @param {Object} transcript - Original transcript {segments, language}
 * @param {Object} options - { model, editorialVoicePath }
 * @returns {Promise<Object>} Enhanced manifest with editorial notes
 */
export async function enhanceManifest(manifest, transcript, options = {}) {
  const {
    model = "claude-sonnet-4-20250514",
  } = options;

  if (!manifest || !transcript) {
    return manifest || assembleManifest({ recordingName: "unknown" });
  }

  const client = new Anthropic();

  // Prepare a concise transcript summary for the prompt
  const transcriptSummary = (transcript.segments || [])
    .slice(0, 100) // Limit to first 100 segments to stay within context
    .map(seg => `[${seg.start?.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const manifestSummary = JSON.stringify({
    type: manifest.type,
    timeline: manifest.timeline.slice(0, 50),
    captions: manifest.captions.slice(0, 20),
    termFlashes: manifest.termFlashes.slice(0, 20),
    metadata: manifest.metadata,
    flags: manifest.flags,
  }, null, 2);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are the Editor agent for a medical/health video pipeline. Review this assembled manifest and provide editorial notes.

VIDEO TYPE: ${manifest.type}
RECORDING: ${manifest.recordingName}

TRANSCRIPT (first 100 segments):
${transcriptSummary}

CURRENT MANIFEST:
${manifestSummary}

Review the manifest for:
1. **Pacing**: Are B-roll placements well-timed? ${manifest.type === "longform" ? "Long-form needs B-roll every 15-20s for retention." : "Shorts need selective, topic-relevant B-roll only."}
2. **Term Flashes**: Are the right terms highlighted? Any missing medical/technical terms?
3. **Caption Quality**: Any captions that seem too long or awkward?
4. **Cut Rhythm**: Are there jump cuts or unnatural transitions?
5. **Overall Flow**: Does the edit feel like a Huberman/Attia-style authoritative presentation?

Respond with a JSON object:
{
  "editorialNotes": [
    {"category": "pacing|terms|captions|cuts|flow", "note": "description", "severity": "info|suggestion|concern", "timestamp": null}
  ],
  "suggestedChanges": [
    {"type": "add_broll|remove_broll|adjust_timing|add_term_flash|remove_term_flash", "details": "what to change", "at": null}
  ],
  "overallAssessment": "brief summary of edit quality",
  "readyForCritic": true
}

Return ONLY the JSON object, no markdown or explanation.`,
      },
    ],
  });

  // Parse the editor's response
  const responseText = response.content[0]?.text || "{}";

  let editorReview;
  try {
    // Handle possible markdown code fences
    const jsonStr = responseText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    editorReview = JSON.parse(jsonStr);
  } catch {
    // If parsing fails, create a minimal review
    editorReview = {
      editorialNotes: [{ category: "flow", note: "Editor review parsing failed — manifest passes through unchanged", severity: "info" }],
      suggestedChanges: [],
      overallAssessment: "Review inconclusive",
      readyForCritic: true,
    };
  }

  // Apply the editor's notes to the manifest
  return {
    ...manifest,
    editorialNotes: editorReview.editorialNotes || [],
    editorAssessment: editorReview.overallAssessment || "",
    suggestedChanges: editorReview.suggestedChanges || [],
    readyForCritic: editorReview.readyForCritic !== false,
  };
}

/**
 * Full Editor agent pipeline: assemble + enhance.
 *
 * @param {Object} params - Pipeline outputs
 * @param {Object} options - { model }
 * @returns {Promise<Object>} Complete manifest ready for Critic
 */
export async function generateManifest(params, options = {}) {
  const manifest = assembleManifest(params);
  return enhanceManifest(manifest, params.transcript, options);
}
