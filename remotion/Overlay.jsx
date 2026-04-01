/**
 * Overlay Composition — Root Remotion component
 *
 * Renders captions and term flashes on a transparent background.
 * Output is ProRes 4444 with alpha channel for FFmpeg compositing.
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { Caption } from "./Caption.jsx";
import { TermFlash } from "./TermFlash.jsx";
import { ChapterTitle } from "./ChapterTitle.jsx";

/**
 * Main overlay composition.
 *
 * Props (via inputProps):
 * - captions: Array of caption entries [{id, start, end, text}]
 * - termFlashes: Array of term flash entries [{id, start, end, text, type}]
 * - chapterTitles: Array of chapter title entries [{id, start, end, text}] (longform only)
 * - captionPreset: "white-on-black" | "black-on-white"
 * - captionStyle: "short" | "longform"
 * - videoWidth: pixel width
 * - videoHeight: pixel height
 */
export const Overlay = ({
  captions = [],
  termFlashes = [],
  chapterTitles = [],
  captionPreset = "white-on-black",
  captionStyle = "short",
  videoWidth = 1920,
  videoHeight = 1080,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {captionStyle === "longform" && chapterTitles.length > 0 && (
        <ChapterTitle
          chapterTitles={chapterTitles}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
        />
      )}
      <Caption
        captions={captions}
        preset={captionPreset}
        style={captionStyle}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
      />
      <TermFlash
        termFlashes={termFlashes}
        captionStyle={captionStyle}
        videoHeight={videoHeight}
      />
    </AbsoluteFill>
  );
};
