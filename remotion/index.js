/**
 * Remotion Entry Point — Registers compositions for rendering
 *
 * This file is the entry point for `npx remotion render`.
 * It registers the Overlay composition that produces transparent ProRes overlays.
 */

import { registerRoot } from "remotion";
import { Composition } from "remotion";
import React from "react";
import { Overlay } from "./Overlay.jsx";

const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="CaptionOverlay"
        component={Overlay}
        durationInFrames={900} // 30s at 30fps — overridden at render time
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          captions: [],
          termFlashes: [],
          chapterTitles: [],
          captionPreset: "white-on-black",
          captionStyle: "short",
          videoWidth: 1920,
          videoHeight: 1080,
        }}
      />
      <Composition
        id="CaptionOverlayVertical"
        component={Overlay}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          captions: [],
          termFlashes: [],
          chapterTitles: [],
          captionPreset: "white-on-black",
          captionStyle: "short",
          videoWidth: 1080,
          videoHeight: 1920,
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
