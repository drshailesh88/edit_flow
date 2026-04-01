# Roadmap — AI Video Editor Pipeline

## Phases

- [x] Phase 1: Tracer Bullet — Raw Recording to Silence-Removed MP4
  - **Deliverable:** Drop a 30-min Recording in, get a silence-removed Long-form MP4 out
  - **Requirements:** Ingest (Whisper transcription), silence detection (FFmpeg), Take selection (Claude picks Best Takes), FFmpeg assembly (cut and concatenate)
  - **Why first:** Proves the core architecture works end-to-end. Every other phase builds on this foundation. If Whisper can't handle Hinglish or 16GB is too tight, we find out here.
  - Risk: **HIGH** (Whisper memory on 16GB, Hindi/Hinglish accuracy, take detection quality)

- [x] Phase 2: Shorts Extraction — One Recording to 7-8 Standalone Shorts
  - **Deliverable:** Pipeline produces 7-8 individual MP4s (one per Section) from a single Recording
  - **Requirements:** Shorts Extractor (Claude identifies Section boundaries), Auto-Reframe (16:9 → 9:16 face-centered crop), per-Short FFmpeg assembly
  - **Why second:** Shorts are the daily posting content. Getting these working unlocks the creator's core publishing cadence (1 short/day).
  - Risk: **MEDIUM** (auto-reframe quality, Section boundary detection accuracy)

- [x] Phase 3: B-roll Automation — Library Indexing and Placement
  - **Deliverable:** B-roll from SSD Library automatically placed in Long-form (every 15-20s) and Shorts (selectively)
  - **Requirements:** B-roll Indexer (SQLite from SSD Library), B-roll Matcher (Claude matches transcript to index), FFmpeg B-roll insertion at timestamps, Yellow flag when no Match found
  - **Why third:** B-roll is the biggest time sink in manual editing. Automating it is the highest-value feature after basic cuts.
  - Risk: **MEDIUM** (match quality depends on index descriptions, B-roll timing at natural transitions)

- [x] Phase 4: Captions and Term Flashes — Remotion Overlay Pipeline
  - **Deliverable:** Videos have English transcreated Captions and Term Flash overlays rendered as transparent ProRes overlays composited by FFmpeg
  - **Requirements:** Transcreator (Hindi/Hinglish → English), Term Identifier (medical terms + emphasis points), Remotion Overlay Renderer (Caption component with 2 presets + TermFlash component), FFmpeg composite, auto-brightness Caption style selection, brand theming (ThemeProvider)
  - **Why fourth:** Captions are table stakes for social media. Term Flashes differentiate from generic content. Remotion is introduced here (not earlier) because simpler phases validate the core pipeline first.
  - Risk: **MEDIUM** (transcreation quality, Remotion render speed, ProRes alpha compositing)

- [x] Phase 5: Adversarial Quality Loop — Editor/Critic/Resolver
  - **Deliverable:** Every Manifest is evaluated by a Critic agent against the Editorial Voice before rendering. Outputs tagged Green/Yellow/Red.
  - **Requirements:** Editor agent (generates Manifest), Critic agent (attacks Manifest using Editorial Voice), Resolver agent (applies valid fixes), Convergence logic (3 rounds default, 5 max), Confidence Tagger (Green/Yellow/Red)
  - **Why fifth:** The adversarial loop is the quality gate. Building it after all pipeline stages exist means the Critic can evaluate complete Manifests (cuts + B-roll + Captions + Term Flashes), not partial ones.
  - Risk: **HIGH** (Critic effectiveness depends on Editorial Voice quality, loop convergence behavior, token usage per Round)

- [x] Phase 6: Overnight Batch Processing — Queue and Multi-Recording
  - **Deliverable:** Queue 5-7 Recordings, process them all overnight, wake up to tagged outputs ready for review
  - **Requirements:** Queue system (JSON status tracking), sequential processing, /review-queue command, overnight runner (headless Claude Code or shell script), Chapter Titles for Long-form, FCP XML export (xmeml with V1-V4 tracks)
  - **Why sixth:** Batch processing is the operational target (100 videos/month). Building it after the full pipeline works on single Recordings means the queue just orchestrates proven stages.
  - Risk: **LOW** (queue logic is straightforward, overnight reliability is the main concern)

- [ ] Phase 7: Brand Profiles and Editorial Voice — Multi-Business Support
  - **Deliverable:** Multiple Brands with distinct Editorial Voices, caption styles, and B-roll filters. Critic uses the correct voice per Brand.
  - **Requirements:** Brand Config (config/brands/ structure), Editorial Voice documents written by founder, Brand-specific B-roll filter, /fix command for natural language corrections, YouTube metadata suggestions
  - **Why seventh:** Multi-business support is needed for scale but the core pipeline works with a single default Brand. The founder must write Editorial Voice documents — this is human work, not code.
  - Risk: **LOW** (config loading is simple, but Editorial Voice writing is founder time)

- [ ] Phase 8: Track B Experiment — Claude Drives DaVinci Resolve
  - **Deliverable:** Same intelligence layer, but Resolve renders the final output via Python/MCP scripting API. Compare quality against Track A.
  - **Requirements:** Resolve Studio ($295), samuelgursky/davinci-resolve-mcp integration, Python scripts for timeline creation and rendering, comparison framework (same Recording processed by both tracks)
  - **Why last:** Experimental. Track A must be proven first. Track B is an upgrade path, not a dependency.
  - Risk: **MEDIUM** (MCP server is beta, Resolve must be running, API gaps for clip repositioning)
