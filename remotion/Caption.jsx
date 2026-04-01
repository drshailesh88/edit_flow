/**
 * Caption Component — Remotion overlay for video captions
 *
 * Two presets: "white-on-black" and "black-on-white"
 * Two styles: "short" (lower third, moderate size) and "longform" (smaller, bottom)
 * No animation per PRD — captions appear/disappear cleanly.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { CAPTION_PRESETS, CAPTION_STYLES, getActiveCaption } from "../src/caption-config.js";

// Re-export for convenience
export { CAPTION_PRESETS, CAPTION_STYLES, getActiveCaption };

/**
 * Caption React component for Remotion rendering.
 *
 * Props:
 * - captions: Array of caption entries [{id, start, end, text}]
 * - preset: "white-on-black" | "black-on-white"
 * - style: "short" | "longform"
 * - videoWidth: width in pixels (default 1920)
 * - videoHeight: height in pixels (default 1080)
 */
export const Caption = ({
  captions = [],
  preset = "white-on-black",
  style = "short",
  videoWidth = 1920,
  videoHeight = 1080,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTime = frame / fps;
  const activeCaption = getActiveCaption(captions, currentTime);

  if (!activeCaption) return null;

  const presetConfig = CAPTION_PRESETS[preset] || CAPTION_PRESETS["white-on-black"];
  const styleConfig = CAPTION_STYLES[style] || CAPTION_STYLES["short"];

  const containerStyle = {
    position: "absolute",
    bottom: styleConfig.bottomOffset,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  };

  const textBoxStyle = {
    backgroundColor: presetConfig.backgroundColor,
    color: presetConfig.color,
    fontSize: styleConfig.fontSize,
    fontWeight: styleConfig.fontWeight,
    lineHeight: styleConfig.lineHeight,
    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    padding: `${styleConfig.paddingVertical}px ${styleConfig.paddingHorizontal}px`,
    borderRadius: styleConfig.borderRadius,
    maxWidth: styleConfig.maxWidth,
    textAlign: "center",
    letterSpacing: "-0.01em",
  };

  return (
    <div style={containerStyle}>
      <div style={textBoxStyle}>
        {activeCaption.text}
      </div>
    </div>
  );
};
