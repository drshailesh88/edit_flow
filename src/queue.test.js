/**
 * Tests for Queue Module — Phase 6
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  QUEUE_STATUSES,
  createQueueEntry,
  loadQueue,
  saveQueue,
  createEmptyQueue,
  addToQueue,
  getNextReady,
  updateEntryStatus,
  resetStaleEntries,
  getQueueStats,
  formatQueueStatus,
  processQueue,
} from "./queue.js";

const TEST_QUEUE_PATH = join(process.cwd(), "test-queue.json");

afterEach(() => {
  try { unlinkSync(TEST_QUEUE_PATH); } catch {}
});

describe("QUEUE_STATUSES", () => {
  it("contains expected statuses", () => {
    assert.deepEqual(QUEUE_STATUSES, ["ready", "processing", "done", "failed"]);
  });
});

describe("createQueueEntry", () => {
  it("creates entry with correct defaults", () => {
    const entry = createQueueEntry("/path/to/recording.mp4");
    assert.equal(entry.recordingPath, "/path/to/recording.mp4");
    assert.equal(entry.recordingName, "recording");
    assert.equal(entry.status, "ready");
    assert.equal(entry.priority, 0);
    assert.equal(entry.brollLibraryPath, null);
    assert.ok(typeof entry.id === "string" && entry.id.length > 0);
    assert.ok(entry.addedAt);
    assert.equal(entry.startedAt, null);
    assert.equal(entry.completedAt, null);
    assert.equal(entry.error, null);
    assert.equal(entry.confidenceTag, null);
  });

  it("accepts priority and brollLibraryPath options", () => {
    const entry = createQueueEntry("/rec.mp4", { priority: 5, brollLibraryPath: "/broll" });
    assert.equal(entry.priority, 5);
    assert.equal(entry.brollLibraryPath, "/broll");
  });

  it("throws for empty path", () => {
    assert.throws(() => createQueueEntry(""), { message: /recordingPath is required/ });
    assert.throws(() => createQueueEntry(null), { message: /recordingPath is required/ });
  });

  it("strips file extension from recordingName", () => {
    const entry = createQueueEntry("/path/my-video.mov");
    assert.equal(entry.recordingName, "my-video");
  });
});

describe("createEmptyQueue", () => {
  it("creates queue with empty entries and metadata", () => {
    const queue = createEmptyQueue();
    assert.deepEqual(queue.entries, []);
    assert.ok(queue.metadata.createdAt);
    assert.equal(queue.metadata.version, 1);
  });
});

describe("loadQueue / saveQueue", () => {
  it("returns empty queue when file does not exist", async () => {
    const queue = await loadQueue(TEST_QUEUE_PATH);
    assert.deepEqual(queue.entries, []);
  });

  it("saves and loads queue roundtrip", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec1.mp4");
    addToQueue(queue, "/rec2.mp4");

    await saveQueue(queue, TEST_QUEUE_PATH);
    assert.ok(existsSync(TEST_QUEUE_PATH));

    const loaded = await loadQueue(TEST_QUEUE_PATH);
    assert.equal(loaded.entries.length, 2);
    assert.equal(loaded.entries[0].recordingPath, "/rec1.mp4");
    assert.equal(loaded.entries[1].recordingPath, "/rec2.mp4");
  });

  it("handles corrupted queue file gracefully", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(TEST_QUEUE_PATH, "not valid json", "utf-8");

    const queue = await loadQueue(TEST_QUEUE_PATH);
    assert.deepEqual(queue.entries, []);
  });

  it("saveQueue throws for invalid state", async () => {
    await assert.rejects(
      () => saveQueue(null, TEST_QUEUE_PATH),
      { message: /Invalid queue state/ }
    );
  });
});

describe("addToQueue", () => {
  it("adds entry to queue", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/recording.mp4");

    assert.equal(queue.entries.length, 1);
    assert.equal(entry.status, "ready");
    assert.equal(entry.recordingPath, "/recording.mp4");
  });

  it("prevents duplicate active entries", () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/recording.mp4");

    assert.throws(
      () => addToQueue(queue, "/recording.mp4"),
      { message: /already in queue/ }
    );
  });

  it("allows re-adding a done recording", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/recording.mp4");
    updateEntryStatus(queue, entry.id, "processing");
    updateEntryStatus(queue, entry.id, "done");

    // Should not throw — re-queue a completed recording
    const entry2 = addToQueue(queue, "/recording.mp4");
    assert.equal(entry2.status, "ready");
    assert.equal(queue.entries.length, 2);
  });

  it("throws for invalid queue state", () => {
    assert.throws(() => addToQueue(null, "/rec.mp4"), { message: /Invalid queue state/ });
  });
});

describe("getNextReady", () => {
  it("returns first ready entry (FIFO)", () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec1.mp4");
    addToQueue(queue, "/rec2.mp4");

    const next = getNextReady(queue);
    assert.equal(next.recordingPath, "/rec1.mp4");
  });

  it("returns highest priority first", () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec1.mp4", { priority: 1 });
    addToQueue(queue, "/rec2.mp4", { priority: 5 });
    addToQueue(queue, "/rec3.mp4", { priority: 3 });

    const next = getNextReady(queue);
    assert.equal(next.recordingPath, "/rec2.mp4");
  });

  it("skips processing/done/failed entries", () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/rec1.mp4");
    addToQueue(queue, "/rec2.mp4");

    updateEntryStatus(queue, e1.id, "processing");

    const next = getNextReady(queue);
    assert.equal(next.recordingPath, "/rec2.mp4");
  });

  it("returns null when no ready entries", () => {
    const queue = createEmptyQueue();
    assert.equal(getNextReady(queue), null);
  });

  it("returns null for null queue", () => {
    assert.equal(getNextReady(null), null);
  });
});

describe("updateEntryStatus", () => {
  it("updates status to processing with startedAt", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "processing");
    assert.equal(entry.status, "processing");
    assert.ok(entry.startedAt);
  });

  it("updates status to done with completedAt and actualDuration", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "processing");
    // Simulate some time passing
    entry.startedAt = new Date(Date.now() - 5000).toISOString();

    updateEntryStatus(queue, entry.id, "done");
    assert.equal(entry.status, "done");
    assert.ok(entry.completedAt);
    assert.ok(entry.actualDuration >= 0);
  });

  it("merges extra fields", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "processing");
    updateEntryStatus(queue, entry.id, "done", {
      confidenceTag: "green",
      phasesCompleted: [1, 2, 3, 4, 5],
    });

    assert.equal(entry.confidenceTag, "green");
    assert.deepEqual(entry.phasesCompleted, [1, 2, 3, 4, 5]);
  });

  it("does not overwrite structural fields via extra", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");
    const originalId = entry.id;

    updateEntryStatus(queue, entry.id, "processing");
    updateEntryStatus(queue, entry.id, "done", { id: "hacked", status: "ready", recordingPath: "/evil" });
    assert.equal(entry.id, originalId);
    assert.equal(entry.status, "done");
    assert.equal(entry.recordingPath, "/rec.mp4");
  });

  it("sets error on failure", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "failed", { error: "Whisper crashed" });
    assert.equal(entry.status, "failed");
    assert.equal(entry.error, "Whisper crashed");
  });

  it("throws for invalid status", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    assert.throws(
      () => updateEntryStatus(queue, entry.id, "invalid"),
      { message: /Invalid status/ }
    );
  });

  it("throws for unknown entry ID", () => {
    const queue = createEmptyQueue();
    assert.throws(
      () => updateEntryStatus(queue, "nonexistent", "done"),
      { message: /not found/ }
    );
  });
});

describe("getQueueStats", () => {
  it("returns zeroes for empty queue", () => {
    const stats = getQueueStats(createEmptyQueue());
    assert.equal(stats.total, 0);
    assert.equal(stats.ready, 0);
    assert.equal(stats.done, 0);
  });

  it("counts entries by status", () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/r1.mp4");
    const e2 = addToQueue(queue, "/r2.mp4");
    addToQueue(queue, "/r3.mp4");

    updateEntryStatus(queue, e1.id, "processing");
    updateEntryStatus(queue, e1.id, "done", { confidenceTag: "green" });
    updateEntryStatus(queue, e2.id, "failed", { error: "crash" });

    const stats = getQueueStats(queue);
    assert.equal(stats.total, 3);
    assert.equal(stats.done, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.ready, 1);
    assert.deepEqual(stats.byConfidence, { green: 1 });
  });

  it("handles null queue", () => {
    const stats = getQueueStats(null);
    assert.equal(stats.total, 0);
  });
});

describe("formatQueueStatus", () => {
  it("shows empty message for no entries", () => {
    const result = formatQueueStatus(createEmptyQueue());
    assert.ok(result.includes("empty"));
  });

  it("formats entries with status icons", () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/recording-1.mp4");
    const e2 = addToQueue(queue, "/recording-2.mp4");

    updateEntryStatus(queue, e1.id, "processing");
    updateEntryStatus(queue, e1.id, "done", { confidenceTag: "green" });

    const result = formatQueueStatus(queue);
    assert.ok(result.includes("QUEUE STATUS"));
    assert.ok(result.includes("[DONE]"));
    assert.ok(result.includes("[GREEN]"));
    assert.ok(result.includes("[READY]"));
    assert.ok(result.includes("recording-1"));
    assert.ok(result.includes("recording-2"));
  });

  it("shows error for failed entries", () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/rec.mp4");
    updateEntryStatus(queue, e1.id, "failed", { error: "Out of memory" });

    const result = formatQueueStatus(queue);
    assert.ok(result.includes("[FAIL]"));
    assert.ok(result.includes("Out of memory"));
  });

  it("handles null queue", () => {
    const result = formatQueueStatus(null);
    assert.ok(result.includes("empty"));
  });
});

describe("processQueue", () => {
  it("processes all ready entries sequentially", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec1.mp4");
    addToQueue(queue, "/rec2.mp4");
    addToQueue(queue, "/rec3.mp4");

    await saveQueue(queue, TEST_QUEUE_PATH);

    const processedEntries = [];
    const result = await processQueue({
      queuePath: TEST_QUEUE_PATH,
      processRecording: async (entry) => {
        processedEntries.push(entry.recordingPath);
        return { confidenceTag: "green", phasesCompleted: [1, 2, 3, 4, 5] };
      },
    });

    assert.equal(result.processed, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(processedEntries, ["/rec1.mp4", "/rec2.mp4", "/rec3.mp4"]);

    // Verify persisted state
    const saved = await loadQueue(TEST_QUEUE_PATH);
    assert.ok(saved.entries.every(e => e.status === "done"));
    assert.ok(saved.entries.every(e => e.confidenceTag === "green"));
  });

  it("marks failed entries and continues", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/good.mp4");
    addToQueue(queue, "/bad.mp4");
    addToQueue(queue, "/good2.mp4");

    await saveQueue(queue, TEST_QUEUE_PATH);

    const result = await processQueue({
      queuePath: TEST_QUEUE_PATH,
      processRecording: async (entry) => {
        if (entry.recordingPath === "/bad.mp4") {
          throw new Error("Whisper crashed");
        }
        return { confidenceTag: "green", phasesCompleted: [1, 2, 3, 4, 5] };
      },
    });

    assert.equal(result.processed, 2);
    assert.equal(result.failed, 1);

    const saved = await loadQueue(TEST_QUEUE_PATH);
    const badEntry = saved.entries.find(e => e.recordingPath === "/bad.mp4");
    assert.equal(badEntry.status, "failed");
    assert.equal(badEntry.error, "Whisper crashed");
  });

  it("respects time limit", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec1.mp4");
    addToQueue(queue, "/rec2.mp4");

    await saveQueue(queue, TEST_QUEUE_PATH);

    let progressCalls = [];
    const result = await processQueue({
      queuePath: TEST_QUEUE_PATH,
      maxHours: 0, // 0 hours = immediate timeout
      processRecording: async () => ({ confidenceTag: "green" }),
      onProgress: (entry, phase) => { progressCalls.push(phase); },
    });

    assert.equal(result.skipped, 2);
    assert.ok(progressCalls.includes("time_limit_reached"));
  });

  it("throws if processRecording is not provided", async () => {
    await assert.rejects(
      () => processQueue({ queuePath: TEST_QUEUE_PATH }),
      { message: /processRecording function is required/ }
    );
  });

  it("fires onProgress callbacks", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec.mp4");
    await saveQueue(queue, TEST_QUEUE_PATH);

    const events = [];
    await processQueue({
      queuePath: TEST_QUEUE_PATH,
      processRecording: async () => ({ confidenceTag: "yellow" }),
      onProgress: (entry, phase) => { events.push({ path: entry?.recordingPath, phase }); },
    });

    assert.equal(events.length, 2);
    assert.equal(events[0].phase, "started");
    assert.equal(events[1].phase, "completed");
  });
});

describe("adversarial — Codex-found edge cases", () => {
  it("resetStaleEntries resets processing entries to ready (crash recovery)", () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/rec1.mp4");
    const e2 = addToQueue(queue, "/rec2.mp4");

    updateEntryStatus(queue, e1.id, "processing");
    // e2 stays ready

    const resetCount = resetStaleEntries(queue);
    assert.equal(resetCount, 1);
    assert.equal(e1.status, "ready");
    assert.equal(e1.startedAt, null);
    assert.equal(e2.status, "ready");
  });

  it("resetStaleEntries returns 0 for clean queue", () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec.mp4");
    assert.equal(resetStaleEntries(queue), 0);
  });

  it("processQueue resets stale entries on startup", async () => {
    const queue = createEmptyQueue();
    const e1 = addToQueue(queue, "/rec.mp4");
    updateEntryStatus(queue, e1.id, "processing");

    await saveQueue(queue, TEST_QUEUE_PATH);

    const events = [];
    await processQueue({
      queuePath: TEST_QUEUE_PATH,
      processRecording: async () => ({ confidenceTag: "green" }),
      onProgress: (entry, phase, extra) => { events.push({ phase, extra }); },
    });

    // Should have reset the stale entry and then processed it
    assert.ok(events.some(e => e.phase === "reset_stale"));
    assert.ok(events.some(e => e.phase === "completed"));

    const saved = await loadQueue(TEST_QUEUE_PATH);
    assert.equal(saved.entries[0].status, "done");
  });

  it("updateEntryStatus rejects invalid transitions", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    // ready -> done is not allowed (must go through processing)
    assert.throws(
      () => updateEntryStatus(queue, entry.id, "done"),
      { message: /Invalid transition/ }
    );
  });

  it("updateEntryStatus allows valid transition chain", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "processing");
    updateEntryStatus(queue, entry.id, "done");
    assert.equal(entry.status, "done");

    // Re-queue: done -> ready
    updateEntryStatus(queue, entry.id, "ready");
    assert.equal(entry.status, "ready");
    assert.equal(entry.startedAt, null);
    assert.equal(entry.completedAt, null);
  });

  it("updateEntryStatus only merges allowed extra fields", () => {
    const queue = createEmptyQueue();
    const entry = addToQueue(queue, "/rec.mp4");

    updateEntryStatus(queue, entry.id, "processing");
    updateEntryStatus(queue, entry.id, "done", {
      confidenceTag: "green",
      recordingPath: "/evil",  // should be ignored
      startedAt: null,         // should be ignored
    });

    assert.equal(entry.confidenceTag, "green");
    assert.equal(entry.recordingPath, "/rec.mp4");
    assert.ok(entry.startedAt !== null);
  });

  it("createQueueEntry generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(createQueueEntry(`/rec${i}.mp4`).id);
    }
    assert.equal(ids.size, 100, "All 100 IDs should be unique");
  });

  it("saveQueue uses atomic write (temp + rename)", async () => {
    const queue = createEmptyQueue();
    addToQueue(queue, "/rec.mp4");

    await saveQueue(queue, TEST_QUEUE_PATH);

    // Verify the file was written correctly
    const content = await readFile(TEST_QUEUE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    assert.equal(parsed.entries.length, 1);

    // Verify no .tmp file left behind
    assert.ok(!existsSync(TEST_QUEUE_PATH + ".tmp"));
  });
});
