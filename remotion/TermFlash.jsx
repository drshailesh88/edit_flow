/**
 * TermFlash Component — Remotion overlay for term flash display
 *
 * Displays technical terms and key claims with:
 * - Clean sans-serif, white text, semi-transparent dark background
 * - Fade in/out 0.3s
 * - Positioned above captions (upper area)
 */

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  TERMFLASH_STYLE,
  getActiveTermFlash,
  getSafeFlashPosition,
} from "../src/termflash-config.js";

/**
 * TermFlash React component for Remotion rendering.
 *
 * Props:
 * - termFlashes: Array of term flash entries [{id, start, end, text, type}]
 * - captionStyle: "short" | "longform" (for collision avoidance)
 * - videoHeight: pixel height
 */
export const TermFlash = ({
  termFlashes = [],
  captionStyle = "short",
  videoHeight = 1080,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTime = frame / fps;
  const activeFlash = getActiveTermFlash(termFlashes, currentTime);

  if (!activeFlash) return null;

  const topPosition = getSafeFlashPosition(captionStyle, videoHeight);

  const containerStyle = {
    position: "absolute",
    top: topPosition,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    opacity: activeFlash.opacity,
  };

  const textBoxStyle = {
    backgroundColor: TERMFLASH_STYLE.backgroundColor,
    color: TERMFLASH_STYLE.color,
    fontSize: TERMFLASH_STYLE.fontSize,
    fontWeight: TERMFLASH_STYLE.fontWeight,
    fontFamily: TERMFLASH_STYLE.fontFamily,
    padding: `${TERMFLASH_STYLE.paddingVertical}px ${TERMFLASH_STYLE.paddingHorizontal}px`,
    borderRadius: TERMFLASH_STYLE.borderRadius,
    maxWidth: TERMFLASH_STYLE.maxWidth,
    textAlign: "center",
    letterSpacing: TERMFLASH_STYLE.letterSpacing,
  };

  return (
    <div style={containerStyle}>
      <div style={textBoxStyle}>
        {activeFlash.text}
      </div>
    </div>
  );
};
