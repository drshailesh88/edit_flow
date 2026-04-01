/**
 * Overlay Composition — Root Remotion component
 *
 * Renders captions (and later term flashes) on a transparent background.
 * Output is ProRes 4444 with alpha channel for FFmpeg compositing.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { Caption } from "./Caption.jsx";

/**
 * Main overlay composition.
 *
 * Props (via inputProps):
 * - captions: Array of caption entries [{id, start, end, text}]
 * - captionPreset: "white-on-black" | "black-on-white"
 * - captionStyle: "short" | "longform"
 * - videoWidth: pixel width
 * - videoHeight: pixel height
 */
export const Overlay = ({
  captions = [],
  captionPreset = "white-on-black",
  captionStyle = "short",
  videoWidth = 1920,
  videoHeight = 1080,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <Caption
        captions={captions}
        preset={captionPreset}
        style={captionStyle}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
      />
    </AbsoluteFill>
  );
};
