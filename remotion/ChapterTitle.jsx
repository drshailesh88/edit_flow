/**
 * ChapterTitle Component — Remotion overlay for chapter title cards
 *
 * Displays between Sections in long-form videos.
 * Clean, authoritative, minimal style (Huberman/Attia).
 * Fade in/out 0.3s transition.
 *
 * Only rendered for longform videos — Shorts do not have chapter titles.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { CHAPTER_TITLE_STYLE, getActiveChapterTitle } from "../src/chapter-title.js";

/**
 * ChapterTitle React component for Remotion rendering.
 *
 * Props:
 * - chapterTitles: Array of chapter title entries [{id, start, end, text}]
 * - videoWidth: pixel width
 * - videoHeight: pixel height
 */
export const ChapterTitle = ({
  chapterTitles = [],
  videoWidth = 1920,
  videoHeight = 1080,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTime = frame / fps;
  const activeTitle = getActiveChapterTitle(chapterTitles, currentTime);

  if (!activeTitle) return null;

  // Fade in/out over 0.3 seconds (matching TermFlash behavior)
  const fadeFrames = Math.round(0.3 * fps);
  const titleStartFrame = Math.round(activeTitle.start * fps);
  const titleEndFrame = Math.round(activeTitle.end * fps);

  const opacity = interpolate(
    frame,
    [
      titleStartFrame,
      titleStartFrame + fadeFrames,
      titleEndFrame - fadeFrames,
      titleEndFrame,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const containerStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    opacity,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  };

  const textBoxStyle = {
    backgroundColor: CHAPTER_TITLE_STYLE.backgroundColor,
    color: CHAPTER_TITLE_STYLE.color,
    fontSize: CHAPTER_TITLE_STYLE.fontSize,
    fontWeight: CHAPTER_TITLE_STYLE.fontWeight,
    fontFamily: CHAPTER_TITLE_STYLE.fontFamily,
    padding: `${CHAPTER_TITLE_STYLE.paddingVertical}px ${CHAPTER_TITLE_STYLE.paddingHorizontal}px`,
    borderRadius: CHAPTER_TITLE_STYLE.borderRadius,
    maxWidth: CHAPTER_TITLE_STYLE.maxWidth,
    textAlign: "center",
    letterSpacing: CHAPTER_TITLE_STYLE.letterSpacing,
    lineHeight: CHAPTER_TITLE_STYLE.lineHeight,
  };

  return (
    <div style={containerStyle}>
      <div style={textBoxStyle}>
        {activeTitle.text}
      </div>
    </div>
  );
};
