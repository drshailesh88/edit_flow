/**
 * Tests for Resolver Agent Module — Phase 5, Requirement 3
 *
 * Tests deterministic fixes, short segment merging, resolution counting,
 * and the full resolver pipeline (with skipAI for unit tests).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeterministicFixes,
  mergeShortSegments,
  countResolutions,
  resolveManifest,
} from "./resolver-agent.js";

// ─────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────

function makeManifest(overrides = {}) {
  return {
    version: 1,
    recordingName: "test-recording",
    type: "longform",
    timeline: [
      { id: 1, type: "aroll", start: 0, end: 30, duration: 30 },
      { id: 2, type: "broll", start: 15, end: 20, duration: 5, confidence: "green" },
      { id: 3, type: "aroll", start: 32, end: 60, duration: 28 },
    ],
    captions: [
      { id: 1, start: 0, end: 5, text: "Today we discuss cardiac procedures." },
      { id: 2, start: 5, end: 12, text: "The surgery involves bypass grafting." },
    ],
    termFlashes: [
      { id: 1, start: 2, end: 5, text: "Cardiac", type: "term" },
      { id: 2, start: 6, end: 9, text: "Bypass Grafting", type: "term" },
    ],
    metadata: {
      totalDuration: 58,
      arollSegments: 2,
      brollPlacements: 1,
      captionCount: 2,
      termFlashCount: 2,
    },
    flags: [],
    editorialNotes: [],
    ...overrides,
  };
}

function makeCritique(issues = [], overrides = {}) {
  return {
    issues,
    passed: false,
    summary: "Test critique",
    round: 1,
    severity: "major",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────
// mergeShortSegments
// ─────────────────────────────────────────────────────

describe("mergeShortSegments", () => {
  it("returns empty array for null input", () => {
    assert.deepStrictEqual(mergeShortSegments(null), []);
    assert.deepStrictEqual(mergeShortSegments(undefined), []);
  });

  it("passes through timeline with no short segments", () => {
    const timeline = [
      { id: 1, type: "aroll", start: 0, end: 10, duration: 10 },
      { id: 2, type: "aroll", start: 12, end: 25, duration: 13 },
    ];
    const result = mergeShortSegments(timeline);
    assert.equal(result.length, 2);
  });

  it("merges a short segment with the previous one", () => {
    const timeline = [
      { id: 1, type: "aroll", start: 0, end: 10, duration: 10 },
      { id: 2, type: "aroll", start: 10, end: 10.5, duration: 0.5 },
      { id: 3, type: "aroll", start: 12, end: 25, duration: 13 },
    ];
    const result = mergeShortSegments(timeline);
    const aroll = result.filter(e => e.type === "aroll");
    assert.equal(aroll.length, 2);
    assert.equal(aroll[0].end, 10.5); // Extended to absorb short segment
  });

  it("merges a leading short segment with the next one", () => {
    const timeline = [
      { id: 1, type: "aroll", start: 0, end: 0.3, duration: 0.3 },
      { id: 2, type: "aroll", start: 1, end: 10, duration: 9 },
    ];
    const result = mergeShortSegments(timeline);
    const aroll = result.filter(e => e.type === "aroll");
    assert.equal(aroll.length, 1);
    assert.equal(aroll[0].start, 0); // Start extended back
  });

  it("preserves non-aroll entries", () => {
    const timeline = [
      { id: 1, type: "aroll", start: 0, end: 10, duration: 10 },
      { id: 2, type: "broll", start: 5, end: 8, duration: 3, confidence: "green" },
      { id: 3, type: "aroll", start: 10, end: 10.3, duration: 0.3 },
    ];
    const result = mergeShortSegments(timeline);
    const broll = result.filter(e => e.type === "broll");
    assert.equal(broll.length, 1);
  });

  it("reassigns sequential IDs", () => {
    const timeline = [
      { id: 99, type: "aroll", start: 0, end: 10, duration: 10 },
      { id: 100, type: "aroll", start: 12, end: 25, duration: 13 },
    ];
    const result = mergeShortSegments(timeline);
    assert.equal(result[0].id, 1);
    assert.equal(result[1].id, 2);
  });
});

// ─────────────────────────────────────────────────────
// applyDeterministicFixes
// ─────────────────────────────────────────────────────

describe("applyDeterministicFixes", () => {
  it("returns manifest unchanged when no issues", () => {
    const manifest = makeManifest();
    const critique = makeCritique([]);
    const { manifest: revised, changes } = applyDeterministicFixes(manifest, critique);
    assert.equal(changes.length, 0);
    assert.equal(revised.timeline.length, manifest.timeline.length);
  });

  it("handles null inputs gracefully", () => {
    const { manifest, changes } = applyDeterministicFixes(null, null);
    assert.deepStrictEqual(changes, []);
  });

  it("merges short segments when cuts issue exists", () => {
    const manifest = makeManifest({
      timeline: [
        { id: 1, type: "aroll", start: 0, end: 10, duration: 10 },
        { id: 2, type: "aroll", start: 10, end: 10.3, duration: 0.3 },
        { id: 3, type: "aroll", start: 12, end: 25, duration: 13 },
      ],
    });
    const critique = makeCritique([
      { category: "cuts", severity: "minor", description: "1 segment shorter than 1s" },
    ]);
    const { manifest: revised, changes } = applyDeterministicFixes(manifest, critique);
    const cutChange = changes.find(c => c.category === "cuts");
    assert.ok(cutChange);
    const aroll = revised.timeline.filter(e => e.type === "aroll");
    assert.equal(aroll.length, 2); // Merged from 3 to 2
  });

  it("trims long captions when caption issue exists", () => {
    const longText = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const manifest = makeManifest({
      captions: [
        { id: 1, start: 0, end: 10, text: longText },
        { id: 2, start: 10, end: 15, text: "Short caption." },
      ],
    });
    const critique = makeCritique([
      { category: "captions", severity: "minor", description: "1 caption exceeds 20 words" },
    ]);
    const { manifest: revised, changes } = applyDeterministicFixes(manifest, critique);
    assert.ok(revised.captions[0].text.endsWith("..."));
    assert.equal(revised.captions[0].trimmed, true);
    assert.equal(revised.captions[1].text, "Short caption.");
    const capChange = changes.find(c => c.category === "captions");
    assert.ok(capChange);
  });

  it("reduces term flash density when term issue exists", () => {
    const manifest = makeManifest({
      termFlashes: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, start: i * 3, end: i * 3 + 2, text: `Term ${i}`, type: i < 5 ? "term" : "claim",
      })),
      metadata: { totalDuration: 30, arollSegments: 1, brollPlacements: 1, captionCount: 2, termFlashCount: 10 },
    });
    const critique = makeCritique([
      { category: "terms", severity: "minor", description: "High term flash density: 20.0 per minute" },
    ]);
    const { manifest: revised, changes } = applyDeterministicFixes(manifest, critique);
    // 30s = 0.5min → max ~2 flashes (ceil(0.5 * 3) = 2)
    assert.ok(revised.termFlashes.length <= 2);
    // Terms should be kept over claims
    assert.ok(revised.termFlashes.every(f => f.type === "term"));
    const termChange = changes.find(c => c.category === "terms");
    assert.ok(termChange);
  });

  it("updates metadata after fixes", () => {
    const manifest = makeManifest({
      captions: [
        { id: 1, start: 0, end: 10, text: Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ") },
      ],
    });
    const critique = makeCritique([
      { category: "captions", severity: "minor", description: "exceed 20 words" },
    ]);
    const { manifest: revised } = applyDeterministicFixes(manifest, critique);
    assert.equal(revised.metadata.captionCount, 1);
  });

  it("does not mutate the original manifest", () => {
    const manifest = makeManifest();
    const original = JSON.stringify(manifest);
    const critique = makeCritique([
      { category: "cuts", severity: "minor", description: "1s" },
    ]);
    applyDeterministicFixes(manifest, critique);
    assert.equal(JSON.stringify(manifest), original);
  });
});

// ─────────────────────────────────────────────────────
// countResolutions
// ─────────────────────────────────────────────────────

describe("countResolutions", () => {
  it("returns all resolved when changes match all issue categories", () => {
    const issues = [
      { category: "cuts", severity: "minor" },
      { category: "captions", severity: "minor" },
    ];
    const changes = [
      { category: "cuts", description: "fixed" },
      { category: "captions", description: "fixed" },
    ];
    const result = countResolutions(issues, changes);
    assert.equal(result.resolved, 2);
    assert.equal(result.remaining, 0);
    assert.equal(result.resolutionRate, 1);
  });

  it("returns partial resolution correctly", () => {
    const issues = [
      { category: "cuts", severity: "minor" },
      { category: "broll", severity: "major" },
      { category: "terms", severity: "minor" },
    ];
    const changes = [{ category: "cuts", description: "fixed" }];
    const result = countResolutions(issues, changes);
    assert.equal(result.resolved, 1);
    assert.equal(result.remaining, 2);
    assert.ok(result.resolutionRate > 0.3 && result.resolutionRate < 0.4);
  });

  it("handles null inputs", () => {
    const result = countResolutions(null, null);
    assert.equal(result.resolved, 0);
    assert.equal(result.remaining, 0);
    assert.equal(result.resolutionRate, 0);
  });

  it("handles empty issues (100% rate)", () => {
    const result = countResolutions([], []);
    assert.equal(result.resolutionRate, 1);
  });
});

// ─────────────────────────────────────────────────────
// resolveManifest (with skipAI)
// ─────────────────────────────────────────────────────

describe("resolveManifest", () => {
  it("applies deterministic fixes and returns resolution metadata", async () => {
    const manifest = makeManifest({
      timeline: [
        { id: 1, type: "aroll", start: 0, end: 10, duration: 10 },
        { id: 2, type: "aroll", start: 10, end: 10.3, duration: 0.3 },
        { id: 3, type: "aroll", start: 12, end: 25, duration: 13 },
      ],
    });
    const critique = makeCritique([
      { category: "cuts", severity: "minor", description: "1 segment shorter than 1s" },
    ]);

    const result = await resolveManifest(manifest, critique, { skipAI: true });

    assert.ok(result.manifest);
    assert.ok(result.changes.length > 0);
    assert.ok(result.resolutions);
    assert.equal(result.manifest.lastResolution.round, 1);
  });

  it("skips AI when no remaining issues", async () => {
    const manifest = makeManifest();
    const critique = makeCritique([], { passed: true });

    const result = await resolveManifest(manifest, critique, { skipAI: false });

    assert.equal(result.aiChanges.length, 0);
    assert.equal(result.changes.length, 0);
  });

  it("preserves manifest structure after resolution", async () => {
    const manifest = makeManifest();
    const critique = makeCritique([
      { category: "broll", severity: "minor", description: "confidence issues" },
    ]);

    const result = await resolveManifest(manifest, critique, { skipAI: true });

    assert.equal(result.manifest.version, 1);
    assert.equal(result.manifest.recordingName, "test-recording");
    assert.ok(result.manifest.lastResolution);
  });
});
