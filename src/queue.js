/**
 * Queue Module — Phase 6
 *
 * Manages a queue of Recordings for sequential overnight processing.
 * Queue state is persisted as JSON for crash recovery.
 *
 * Status flow per Recording: ready → processing → done | failed
 *
 * Design:
 * - Queue file lives at data/queue.json
 * - Each entry tracks recording path, status, timestamps, confidence tag
 * - Processing is sequential (one Recording at a time, 16GB constraint)
 * - Target: 6-7 Recordings in a 10-hour overnight window (~85-100 min each)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

/**
 * Valid queue entry statuses.
 */
export const QUEUE_STATUSES = ["ready", "processing", "done", "failed"];

/**
 * Default queue file path.
 */
export const DEFAULT_QUEUE_PATH = "data/queue.json";

/**
 * Create a new queue entry for a Recording.
 *
 * @param {string} recordingPath - Path to the recording file
 * @param {Object} options - { priority, brollLibraryPath }
 * @returns {Object} Queue entry
 */
export function createQueueEntry(recordingPath, options = {}) {
  if (!recordingPath || typeof recordingPath !== "string") {
    throw new Error("recordingPath is required");
  }

  return {
    id: generateId(),
    recordingPath,
    recordingName: basename(recordingPath).replace(/\.[^.]+$/, ""),
    status: "ready",
    priority: options.priority ?? 0,
    brollLibraryPath: options.brollLibraryPath ?? null,
    addedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    confidenceTag: null,
    phasesCompleted: [],
    estimatedDuration: null,
    actualDuration: null,
  };
}

/**
 * Generate a short unique ID for queue entries.
 */
function generateId() {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load the queue from disk.
 *
 * @param {string} queuePath - Path to queue JSON file
 * @returns {Promise<Object>} Queue state { entries, metadata }
 */
export async function loadQueue(queuePath = DEFAULT_QUEUE_PATH) {
  if (!existsSync(queuePath)) {
    return createEmptyQueue();
  }

  try {
    const raw = await readFile(queuePath, "utf-8");
    const data = JSON.parse(raw);

    if (!data || !Array.isArray(data.entries)) {
      return createEmptyQueue();
    }

    return data;
  } catch {
    return createEmptyQueue();
  }
}

/**
 * Create an empty queue state.
 */
export function createEmptyQueue() {
  return {
    entries: [],
    metadata: {
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      version: 1,
    },
  };
}

/**
 * Save the queue to disk.
 *
 * @param {Object} queue - Queue state
 * @param {string} queuePath - Path to queue JSON file
 * @returns {Promise<void>}
 */
export async function saveQueue(queue, queuePath = DEFAULT_QUEUE_PATH) {
  if (!queue || !Array.isArray(queue.entries)) {
    throw new Error("Invalid queue state");
  }

  await mkdir(join(queuePath, ".."), { recursive: true }).catch(() => {});
  queue.metadata = queue.metadata || {};
  queue.metadata.lastUpdated = new Date().toISOString();
  await writeFile(queuePath, JSON.stringify(queue, null, 2), "utf-8");
}

/**
 * Add a Recording to the queue.
 *
 * @param {Object} queue - Queue state
 * @param {string} recordingPath - Path to the recording
 * @param {Object} options - { priority, brollLibraryPath }
 * @returns {Object} The new queue entry
 */
export function addToQueue(queue, recordingPath, options = {}) {
  if (!queue || !Array.isArray(queue.entries)) {
    throw new Error("Invalid queue state");
  }

  // Check for duplicate (same recording path already in queue and not done/failed)
  const existing = queue.entries.find(
    e => e.recordingPath === recordingPath && (e.status === "ready" || e.status === "processing")
  );
  if (existing) {
    throw new Error(`Recording already in queue: ${basename(recordingPath)} (status: ${existing.status})`);
  }

  const entry = createQueueEntry(recordingPath, options);
  queue.entries.push(entry);
  return entry;
}

/**
 * Get the next ready entry from the queue (highest priority first, then FIFO).
 *
 * @param {Object} queue - Queue state
 * @returns {Object|null} Next ready entry or null
 */
export function getNextReady(queue) {
  if (!queue || !Array.isArray(queue.entries)) return null;

  const ready = queue.entries
    .filter(e => e.status === "ready")
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return ready.length > 0 ? ready[0] : null;
}

/**
 * Update a queue entry's status.
 *
 * @param {Object} queue - Queue state
 * @param {string} entryId - Entry ID
 * @param {string} newStatus - New status
 * @param {Object} extra - Additional fields to merge (error, confidenceTag, etc.)
 * @returns {Object} Updated entry
 */
export function updateEntryStatus(queue, entryId, newStatus, extra = {}) {
  if (!queue || !Array.isArray(queue.entries)) {
    throw new Error("Invalid queue state");
  }

  if (!QUEUE_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Valid: ${QUEUE_STATUSES.join(", ")}`);
  }

  const entry = queue.entries.find(e => e.id === entryId);
  if (!entry) {
    throw new Error(`Queue entry not found: ${entryId}`);
  }

  entry.status = newStatus;

  if (newStatus === "processing" && !entry.startedAt) {
    entry.startedAt = new Date().toISOString();
  }

  if (newStatus === "done" || newStatus === "failed") {
    entry.completedAt = new Date().toISOString();
    if (entry.startedAt) {
      entry.actualDuration = (new Date(entry.completedAt) - new Date(entry.startedAt)) / 1000;
    }
  }

  // Merge extra fields
  for (const [key, value] of Object.entries(extra)) {
    if (key !== "id" && key !== "status") {
      entry[key] = value;
    }
  }

  return entry;
}

/**
 * Get queue summary statistics.
 *
 * @param {Object} queue - Queue state
 * @returns {Object} { total, ready, processing, done, failed, byConfidence }
 */
export function getQueueStats(queue) {
  if (!queue || !Array.isArray(queue.entries)) {
    return { total: 0, ready: 0, processing: 0, done: 0, failed: 0, byConfidence: {} };
  }

  const entries = queue.entries;
  const byConfidence = {};

  for (const e of entries) {
    if (e.confidenceTag) {
      byConfidence[e.confidenceTag] = (byConfidence[e.confidenceTag] || 0) + 1;
    }
  }

  return {
    total: entries.length,
    ready: entries.filter(e => e.status === "ready").length,
    processing: entries.filter(e => e.status === "processing").length,
    done: entries.filter(e => e.status === "done").length,
    failed: entries.filter(e => e.status === "failed").length,
    byConfidence,
  };
}

/**
 * Format queue status for display (used by /review-queue).
 *
 * @param {Object} queue - Queue state
 * @returns {string} Formatted status report
 */
export function formatQueueStatus(queue) {
  if (!queue || !Array.isArray(queue.entries) || queue.entries.length === 0) {
    return "Queue is empty. Add recordings with /ingest <path>.";
  }

  const stats = getQueueStats(queue);
  const lines = [];

  lines.push("═══════════════════════════════════════");
  lines.push("QUEUE STATUS");
  lines.push("═══════════════════════════════════════");
  lines.push(`  Total: ${stats.total} | Ready: ${stats.ready} | Processing: ${stats.processing} | Done: ${stats.done} | Failed: ${stats.failed}`);

  if (Object.keys(stats.byConfidence).length > 0) {
    const confStr = Object.entries(stats.byConfidence)
      .map(([tag, count]) => `${tag.toUpperCase()}: ${count}`)
      .join(", ");
    lines.push(`  Confidence: ${confStr}`);
  }

  lines.push("─────────────────────────────────────");

  for (const entry of queue.entries) {
    const statusIcon = entry.status === "done" ? "[DONE]"
      : entry.status === "failed" ? "[FAIL]"
      : entry.status === "processing" ? "[PROC]"
      : "[READY]";

    const confTag = entry.confidenceTag
      ? ` [${entry.confidenceTag.toUpperCase()}]`
      : "";

    const duration = entry.actualDuration
      ? ` (${(entry.actualDuration / 60).toFixed(1)} min)`
      : "";

    const phases = entry.phasesCompleted && entry.phasesCompleted.length > 0
      ? ` phases: ${entry.phasesCompleted.join(",")}`
      : "";

    lines.push(`  ${statusIcon} ${entry.recordingName}${confTag}${duration}${phases}`);

    if (entry.error) {
      lines.push(`         Error: ${entry.error}`);
    }
  }

  lines.push("═══════════════════════════════════════");

  // Estimate remaining time
  const completedEntries = queue.entries.filter(e => e.actualDuration && e.status === "done");
  if (completedEntries.length > 0 && stats.ready > 0) {
    const avgDuration = completedEntries.reduce((sum, e) => sum + e.actualDuration, 0) / completedEntries.length;
    const estimatedRemaining = avgDuration * stats.ready;
    lines.push(`  Estimated remaining: ${(estimatedRemaining / 3600).toFixed(1)} hours (avg ${(avgDuration / 60).toFixed(0)} min/recording)`);
  }

  return lines.join("\n");
}

/**
 * Process the queue sequentially — run full pipeline on each ready Recording.
 *
 * This is the overnight runner. It processes one Recording at a time,
 * updating the queue after each step for crash recovery.
 *
 * @param {Object} options
 * @param {string} options.queuePath - Path to queue file
 * @param {Function} options.processRecording - async function(entry) that runs the full pipeline
 * @param {Function} options.onProgress - callback(entry, phase) for status updates
 * @param {number} options.maxHours - Maximum runtime in hours (default 10)
 * @returns {Promise<Object>} Processing result { processed, failed, skipped }
 */
export async function processQueue(options = {}) {
  const {
    queuePath = DEFAULT_QUEUE_PATH,
    processRecording,
    onProgress,
    maxHours = 10,
  } = options;

  if (typeof processRecording !== "function") {
    throw new Error("processRecording function is required");
  }

  const startTime = Date.now();
  const maxMs = maxHours * 3600 * 1000;
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  const queue = await loadQueue(queuePath);

  while (true) {
    // Check time limit
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxMs) {
      if (onProgress) onProgress(null, "time_limit_reached");
      break;
    }

    // Get next ready entry
    const entry = getNextReady(queue);
    if (!entry) break;

    // Mark as processing
    updateEntryStatus(queue, entry.id, "processing");
    await saveQueue(queue, queuePath);

    if (onProgress) onProgress(entry, "started");

    try {
      const result = await processRecording(entry);

      updateEntryStatus(queue, entry.id, "done", {
        confidenceTag: result?.confidenceTag ?? null,
        phasesCompleted: result?.phasesCompleted ?? [],
      });

      processed++;
      if (onProgress) onProgress(entry, "completed");
    } catch (err) {
      updateEntryStatus(queue, entry.id, "failed", {
        error: err.message || String(err),
      });

      failed++;
      if (onProgress) onProgress(entry, "failed");
    }

    await saveQueue(queue, queuePath);
  }

  // Count remaining
  skipped = queue.entries.filter(e => e.status === "ready").length;

  return { processed, failed, skipped, queue };
}
