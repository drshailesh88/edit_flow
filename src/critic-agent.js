/**
 * Critic Agent Module — Phase 5
 *
 * Evaluates a Manifest against the Editorial Voice document.
 * The Critic attacks the edit — harsh, specific, constructive.
 *
 * Reviews: Manifest JSON + Transcript only (no rendered preview per round).
 *
 * Priority stack (from grill session):
 * 1. Cut placement — are cuts at natural pause points?
 * 2. Bad take removal — were all bad takes caught?
 * 3. B-roll placement — is B-roll at appropriate moments?
 * 4. B-roll appropriateness — does the clip match the topic?
 * 5. Term flash placement — are the right terms highlighted?
 * 6. Caption quality — are captions natural and readable?
 *
 * Output: Critique object with issues, severity, and whether the Manifest passes.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Default editorial voice when no external document is provided.
 * Based on grill session: Huberman/Attia authority zone.
 */
export const DEFAULT_EDITORIAL_VOICE = `
# Editorial Voice — Medical Authority

## Style
- Visual restraint = authority. Clean, minimal, no flash.
- Hard cuts only. No transitions, no dissolves, no wipes.
- No background music. No branded intro/outro.
- Captions: full sentences, always visible, no animation.

## Pacing
- Long-form: B-roll every 15-20 seconds for retention.
- Shorts: selective B-roll at topic-relevant moments only.
- No segment shorter than 1 second (avoid jump cuts).
- Gaps between segments should have B-roll coverage.

## Content
- Technical/medical terms must be highlighted as term flashes.
- Key claims and statistics deserve emphasis.
- Hindi/Hinglish transcreated to natural English, not literal translation.
- Captions should be complete sentences, properly punctuated.

## Anti-Patterns
- Irrelevant B-roll (e.g., city skyline during surgery discussion).
- Too many term flashes (>1 every 15 seconds is overwhelming).
- Captions that are too long (>15 words per caption).
- Missing B-roll in long gaps (>3 seconds of talking head with no visual change).
`.trim();

/**
 * Validate a critique response from the Claude API.
 * Ensures all required fields are present and correctly typed.
 *
 * @param {Object} critique - Raw parsed JSON from Claude
 * @returns {Object} Validated and normalized critique
 */
export function validateCritique(critique) {
  if (!critique || typeof critique !== "object") {
    return {
      issues: [],
      passed: true,
      summary: "No critique provided",
      round: 0,
      severity: "pass",
    };
  }

  const issues = Array.isArray(critique.issues) ? critique.issues.map(issue => ({
    category: typeof issue.category === "string" ? issue.category : "unknown",
    severity: validateSeverity(issue.severity),
    description: typeof issue.description === "string" ? issue.description : "",
    timestamp: typeof issue.timestamp === "number" && Number.isFinite(issue.timestamp) ? issue.timestamp : null,
    suggestion: typeof issue.suggestion === "string" ? issue.suggestion : null,
  })) : [];

  // Determine pass/fail: passes if no critical or major issues
  const hasCritical = issues.some(i => i.severity === "critical");
  const majorCount = issues.filter(i => i.severity === "major").length;
  const passed = !hasCritical && majorCount === 0 && critique.passed !== false;

  return {
    issues,
    passed,
    summary: typeof critique.summary === "string" ? critique.summary : "",
    round: typeof critique.round === "number" ? critique.round : 0,
    severity: hasCritical ? "critical" : majorCount > 0 ? "major" : issues.length > 0 ? "minor" : "pass",
  };
}

/**
 * Validate severity level string.
 * @param {string} severity
 * @returns {string} One of: "critical", "major", "minor", "suggestion"
 */
function validateSeverity(severity) {
  const valid = ["critical", "major", "minor", "suggestion"];
  return valid.includes(severity) ? severity : "minor";
}

/**
 * Score a manifest deterministically before sending to Claude.
 * Catches obvious issues without an API call.
 *
 * @param {Object} manifest - Manifest from editor agent
 * @param {Object} transcript - Original transcript
 * @returns {Array} Issues found by deterministic checks
 */
export function deterministicCritique(manifest, transcript) {
  const issues = [];

  if (!manifest || !manifest.timeline) {
    issues.push({
      category: "structure",
      severity: "critical",
      description: "Manifest is missing or has no timeline",
      timestamp: null,
      suggestion: "Regenerate manifest from pipeline outputs",
    });
    return issues;
  }

  const aroll = manifest.timeline.filter(e => e.type === "aroll");
  const broll = manifest.timeline.filter(e => e.type === "broll");

  // Check 1: Empty timeline
  if (aroll.length === 0) {
    issues.push({
      category: "cuts",
      severity: "critical",
      description: "No A-roll segments in manifest — nothing to render",
      timestamp: null,
      suggestion: "Re-run take selection and segment computation",
    });
  }

  // Check 2: B-roll density for longform
  if (manifest.type === "longform" && manifest.metadata?.totalDuration >= 60) {
    const expectedBroll = Math.floor(manifest.metadata.totalDuration / 20);
    if (broll.length < Math.ceil(expectedBroll * 0.5)) {
      issues.push({
        category: "broll",
        severity: "major",
        description: `Low B-roll density: ${broll.length} placements for ${manifest.metadata.totalDuration.toFixed(0)}s longform video (expected ~${expectedBroll})`,
        timestamp: null,
        suggestion: "Add more B-roll placements every 15-20 seconds",
      });
    }
  }

  // Check 3: B-roll with yellow confidence
  const yellowBroll = broll.filter(e => e.confidence === "yellow");
  if (yellowBroll.length > broll.length * 0.5 && broll.length > 0) {
    issues.push({
      category: "broll",
      severity: "major",
      description: `${yellowBroll.length}/${broll.length} B-roll placements have low confidence — over half are uncertain matches`,
      timestamp: yellowBroll[0]?.start || null,
      suggestion: "Review B-roll library for better matches or flag for manual review",
    });
  }

  // Check 4: Very short segments (jump cuts)
  const shortSegments = aroll.filter(e => e.duration < 1.0);
  if (shortSegments.length > 0) {
    issues.push({
      category: "cuts",
      severity: "minor",
      description: `${shortSegments.length} A-roll segment(s) shorter than 1s — potential jump cuts (editorial voice: no segment < 1 second)`,
      timestamp: shortSegments[0]?.start || null,
      suggestion: "Merge with adjacent segments or remove",
    });
  }

  // Check 5: Term flash density (>1 every 15s is overwhelming)
  if (Array.isArray(manifest.termFlashes) && manifest.metadata?.totalDuration > 0) {
    const flashesPerMinute = (manifest.termFlashes.length / manifest.metadata.totalDuration) * 60;
    if (flashesPerMinute > 4) {
      issues.push({
        category: "terms",
        severity: "minor",
        description: `High term flash density: ${flashesPerMinute.toFixed(1)} per minute — may overwhelm viewers`,
        timestamp: null,
        suggestion: "Reduce to most important 2-3 terms per minute",
      });
    }
  }

  // Check 6: Captions that are too long
  if (Array.isArray(manifest.captions)) {
    const longCaptions = manifest.captions.filter(c => {
      if (!c || typeof c.text !== "string") return false;
      return c.text.trim().split(/\s+/).length > 20;
    });
    if (longCaptions.length > 0) {
      issues.push({
        category: "captions",
        severity: "minor",
        description: `${longCaptions.length} caption(s) exceed 20 words — may be hard to read`,
        timestamp: longCaptions[0]?.start || null,
        suggestion: "Split long captions into shorter sentences",
      });
    }
  }

  // Check 7: Missing captions
  if (!manifest.captions || manifest.captions.length === 0) {
    if (manifest.metadata?.totalDuration > 10) {
      issues.push({
        category: "captions",
        severity: "major",
        description: "No captions in manifest — all videos need captions",
        timestamp: null,
        suggestion: "Run transcreator to generate captions",
      });
    }
  }

  return issues;
}

/**
 * Run the Critic agent against a Manifest.
 * Combines deterministic checks with Claude API critique.
 *
 * @param {Object} manifest - Manifest from editor agent
 * @param {Object} transcript - Original transcript
 * @param {Object} options - { editorialVoice, model, round, skipAI }
 * @returns {Promise<Object>} Critique result
 */
export async function critiqueManifest(manifest, transcript, options = {}) {
  const {
    editorialVoice = DEFAULT_EDITORIAL_VOICE,
    model = "claude-sonnet-4-20250514",
    round = 1,
    skipAI = false,
  } = options;

  // Phase 1: Deterministic checks (no API call)
  const deterministicIssues = deterministicCritique(manifest, transcript);

  // If critical deterministic issues found, skip API call
  const hasCriticalDeterministic = deterministicIssues.some(i => i.severity === "critical");
  if (hasCriticalDeterministic) {
    return validateCritique({
      issues: deterministicIssues,
      passed: false,
      summary: "Critical structural issues found — fix before AI review",
      round,
    });
  }

  // If skipAI, return deterministic-only critique
  if (skipAI) {
    const hasMajor = deterministicIssues.filter(i => i.severity === "major").length > 0;
    return validateCritique({
      issues: deterministicIssues,
      passed: deterministicIssues.length === 0 || (!hasMajor),
      summary: deterministicIssues.length === 0
        ? "No deterministic issues found"
        : `${deterministicIssues.length} deterministic issue(s) found`,
      round,
    });
  }

  // Phase 2: Claude API critique
  const client = new Anthropic();

  const transcriptSummary = (transcript?.segments || [])
    .slice(0, 80)
    .map(seg => `[${seg.start?.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const manifestSummary = JSON.stringify({
    type: manifest.type,
    timeline: manifest.timeline?.slice(0, 40),
    captions: manifest.captions?.slice(0, 15),
    termFlashes: manifest.termFlashes?.slice(0, 15),
    metadata: manifest.metadata,
    flags: manifest.flags,
    editorialNotes: manifest.editorialNotes,
  }, null, 2);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are the Critic agent for a medical/health video pipeline. Round ${round} of adversarial review.

Your job is to ATTACK this manifest. Be harsh, specific, and constructive. The priority stack:
1. Cut placement — are cuts at natural pause points?
2. Bad take removal — were all bad takes caught?
3. B-roll placement — is B-roll at appropriate moments?
4. B-roll appropriateness — does the clip match the topic?
5. Term flash placement — are the right terms highlighted?
6. Caption quality — are captions natural and readable?

EDITORIAL VOICE:
${editorialVoice}

TRANSCRIPT (first 80 segments):
${transcriptSummary}

MANIFEST:
${manifestSummary}

DETERMINISTIC ISSUES ALREADY FOUND:
${JSON.stringify(deterministicIssues, null, 2)}

Review the manifest and respond with a JSON object:
{
  "issues": [
    {
      "category": "cuts|broll|terms|captions|pacing|structure",
      "severity": "critical|major|minor|suggestion",
      "description": "specific problem",
      "timestamp": null,
      "suggestion": "how to fix"
    }
  ],
  "passed": true,
  "summary": "overall assessment",
  "round": ${round}
}

Rules:
- "critical" = must fix, manifest is broken
- "major" = should fix, quality is noticeably worse
- "minor" = nice to fix, small improvement
- "suggestion" = optional polish
- "passed" = true if no critical or major issues remain
- Be specific with timestamps when possible
- Do NOT repeat deterministic issues already listed

Return ONLY the JSON object.`,
      },
    ],
  });

  const responseText = response.content[0]?.text || "{}";

  let aiCritique;
  try {
    const jsonStr = responseText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    aiCritique = JSON.parse(jsonStr);
  } catch {
    aiCritique = {
      issues: [],
      passed: true,
      summary: "Critique parsing failed — manifest passes through",
      round,
    };
  }

  // Merge deterministic and AI issues
  const allIssues = [
    ...deterministicIssues,
    ...(Array.isArray(aiCritique.issues) ? aiCritique.issues : []),
  ];

  return validateCritique({
    issues: allIssues,
    passed: aiCritique.passed,
    summary: aiCritique.summary || "",
    round,
  });
}
