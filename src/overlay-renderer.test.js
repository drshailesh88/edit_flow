/**
 * Tests for the Overlay Renderer module
 *
 * Tests mutex, parameter validation, and helper functions.
 * Actual Remotion/FFmpeg rendering requires real binaries and is tested at integration level.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  acquireRenderLock,
  resetRenderLock,
  renderOverlay,
  compositeOverlay,
  renderAndComposite,
} from "./overlay-renderer.js";

describe("Overlay Renderer — Render Mutex", () => {
  beforeEach(() => {
    resetRenderLock();
  });

  it("should acquire and release lock", async () => {
    const release = await acquireRenderLock();
    assert.ok(typeof release === "function");
    release();
  });

  it("should serialize concurrent lock requests", async () => {
    const order = [];

    const release1 = await acquireRenderLock();
    order.push("acquired-1");

    // Second acquire should wait
    const acquire2Promise = acquireRenderLock().then((release) => {
      order.push("acquired-2");
      release();
    });

    // Release first lock after a microtask
    await new Promise((r) => setTimeout(r, 10));
    order.push("releasing-1");
    release1();

    await acquire2Promise;

    assert.deepEqual(order, ["acquired-1", "releasing-1", "acquired-2"]);
  });

  it("should handle triple serialization", async () => {
    const order = [];

    const release1 = await acquireRenderLock();
    order.push(1);

    const p2 = acquireRenderLock().then((release) => {
      order.push(2);
      release();
    });

    const p3 = acquireRenderLock().then((release) => {
      order.push(3);
      release();
    });

    release1();
    await p2;
    await p3;

    assert.equal(order[0], 1);
    // 2 and 3 should both appear after 1
    assert.ok(order.includes(2));
    assert.ok(order.includes(3));
  });
});

describe("Overlay Renderer — renderOverlay validation", () => {
  it("should reject missing outputPath", async () => {
    await assert.rejects(
      () => renderOverlay({ durationInSeconds: 10 }),
      /outputPath is required/
    );
  });

  it("should reject zero duration", async () => {
    await assert.rejects(
      () => renderOverlay({ outputPath: "/tmp/test.mov", durationInSeconds: 0 }),
      /durationInSeconds must be positive/
    );
  });

  it("should reject negative duration", async () => {
    await assert.rejects(
      () => renderOverlay({ outputPath: "/tmp/test.mov", durationInSeconds: -5 }),
      /durationInSeconds must be positive/
    );
  });
});

describe("Overlay Renderer — compositeOverlay validation", () => {
  it("should reject missing baseVideoPath", async () => {
    await assert.rejects(
      () => compositeOverlay(null, "/tmp/overlay.mov", "/tmp/out.mp4"),
      /baseVideoPath is required/
    );
  });

  it("should reject missing overlayPath", async () => {
    await assert.rejects(
      () => compositeOverlay("/tmp/base.mp4", null, "/tmp/out.mp4"),
      /overlayPath is required/
    );
  });

  it("should reject missing outputPath", async () => {
    await assert.rejects(
      () => compositeOverlay("/tmp/base.mp4", "/tmp/overlay.mov", null),
      /outputPath is required/
    );
  });
});

describe("Overlay Renderer — renderAndComposite validation", () => {
  it("should reject missing baseVideoPath", async () => {
    await assert.rejects(
      () => renderAndComposite({ outputPath: "/tmp/out.mp4" }),
      /baseVideoPath is required/
    );
  });

  it("should reject missing outputPath", async () => {
    await assert.rejects(
      () => renderAndComposite({ baseVideoPath: "/tmp/base.mp4" }),
      /outputPath is required/
    );
  });
});
