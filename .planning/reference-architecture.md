# Reference Architecture Brief — AI Video Editor
**Date:** 2026-04-01
**Sources:** Matt Pocock's total-typescript-monorepo, ButterCut, DigitalSamba Video Toolkit, Remotion ecosystem (5 repos)

---

## 1. Patterns to Steal (by source)

### From Matt Pocock (`total-typescript-monorepo`)

**Remotion as transparent overlay renderer, NOT the full video.**
Matt doesn't render the entire video in Remotion. He renders subtitles + CTA pills as ProRes 4444 (transparent alpha) overlays, then composites them onto the main video with FFmpeg. This keeps the pipeline flexible — Remotion handles what it's good at (animated text/graphics), FFmpeg handles what it's good at (video cutting/encoding).

- Output format: ProRes 4444, `yuva444p10le`, 1080x1920 @ 60fps
- Remotion writes `meta.json` → renders overlay → FFmpeg composites
- Mutex ensures only 1 Remotion render at a time

**Effect-TS service architecture.**
The entire pipeline is built on Effect-TS with dependency injection:
- `FFmpegCommandsService` — wraps all shell commands with error types
- `WorkflowsService` — orchestrates multi-step pipelines
- `AIService` — wraps Claude/Whisper API calls
- Tagged errors: `CouldNotTranscribeAudioError`, `CouldNotDetectSilenceError`, etc.
- Semaphore concurrency: GPU ops limited to 6, transcription to 20, Remotion to 1

**Silence detection pipeline:**
1. FFmpeg `silencedetect` filter, -38dB threshold, 0.8s minimum
2. "Bad take" spoken markers detected and removed
3. Clips extracted with padding (0ms start, 80ms end)
4. GPU-accelerated NVENC encoding at 15Mbps

**Queue-based workflow orchestration.**
JSON file queue with statuses: `ready-to-run`, `completed`, `failed`, `requires-user-input`. Queue items have dependencies. Types: `create-auto-edited-video`, `concatenate-videos`, `analyze-transcript-for-links`, `generate-article-from-transcript`.

**Branded types for path safety:**
```typescript
type AbsolutePath = Brand<string, "AbsolutePath">;
type RelativePath = Brand<string, "RelativePath">;
```

**DaVinci Resolve automation via Lua scripts** (12 scripts for timeline ops, clip appending, subtitle tracks, zoom effects, render queue).

**OpenTelemetry tracing** — full observability on an internal CLI tool. Jaeger + Grafana + Prometheus via Docker.

---

### From ButterCut (`barefootford/buttercut`)

**Skills as progressive disclosure documents.**
Each SKILL.md is under 50 lines. Complex skills delegate to adjacent Ruby scripts or markdown instruction files. The `roughcut` skill launches a sub-agent via Task tool pointed at `agent_instructions.md`.

**7 skills:** setup, transcribe-audio, analyze-video, roughcut, backup-library, update-buttercut, release.

**Parent/child parallelism pattern.**
Parent agent orchestrates, child agents each process one video (max 4 concurrent). Only the parent writes to `library.yaml` — no race conditions.

**YAML as intermediate rough cut format:**
```yaml
clips:
  - source_file: "DJI_0210.mov"
    in_point: "00:00:02.92"
    out_point: "00:00:28.35"
    dialogue: "In order to tell this one..."
    visual_description: "[Man speaking to camera...]"
```
Human-readable, hand-editable, exports to multiple NLE formats.

**Binary search frame extraction.**
Videos ≤30s: 1 frame at 2s. Videos >30s: frames at start, middle, end. Subdivide only where visual content changes. Minimizes Claude vision API costs.

**Visual transcript enrichment.**
Claude reads extracted JPG frames and adds `visual` descriptions + `b_roll: true` markers to the transcript JSON. This creates a rich content index.

**Frame-boundary math with rational fractions.**
All timecodes as fraction strings (`"1001/30000s"`), integer arithmetic, zero floating-point drift. Critical for NLE compatibility.

**`user_context` as institutional memory.**
`library.yaml` accumulates knowledge ("the man in blue is Andrew") across sessions.

**FCPXML 1.8 + xmeml v5 export.**
Deterministic asset IDs via MD5 hash. Supports Final Cut Pro X and Premiere/Resolve.

---

### From DigitalSamba (`claude-code-video-toolkit`)

**Config-driven Remotion compositions.**
The Remotion JSX is generic. All content lives in TypeScript config files (`sprint-config.ts`). Claude Code edits the config, not the composition logic. This is the key separation.

**Discriminated union scene types (v2 pattern):**
```typescript
type SceneConfig = 
  | TitleScene 
  | GoalScene 
  | DemoScene 
  | SummaryScene 
  | CreditsScene 
  // ... 12 types total
```
A `SceneRenderer` switches on `scene.type`. Scenes are reorderable, type-safe, and flexible.

**Smart transition resolution.**
`resolveTransition()` picks defaults based on scene-type pairs (demo → slide, summary → light-leak-warm, credits → fade). Per-scene overrides via `transition` property.

**Brand system:**
- `brands/{name}/brand.json` — colors, fonts, spacing, radius, typography, assets
- `brands/{name}/voice.json` — ElevenLabs/Qwen3-TTS config
- Brand JSON → generated `src/config/brand.ts` → `<ThemeProvider>` → `useTheme()` hook
- Clean separation: visual identity is data, not code

**7 custom transitions:** glitch, rgbSplit, zoomBlur, lightLeak, clockWipe, pixelate, checkerboard. All frame-based (`interpolate()` + `useCurrentFrame()`), no CSS animations.

**External audio pipeline with timing sync:**
1. Write `VOICEOVER-SCRIPT.md`
2. `python tools/voiceover.py` → per-scene MP3 files
3. `python tools/sync_timing.py --apply` → config durations match actual audio
4. Per-scene audio at `public/audio/scenes/*.mp3`

**Slash commands as workflow definitions:**
- `/video` — full lifecycle with state machine (planning → assets → review → audio → editing → rendering → complete)
- `/scene-review` — interactive loop: present scene → user evaluates in Remotion Studio → refine or approve
- `/brand` — CRUD with color extraction from URL
- `/design` — focused visual refinement for a specific scene

**Project reconciliation on resume.**
`/video` command reconciles filesystem state with `project.json` on every resume. If a file exists but project says "asset-needed", it auto-updates.

---

### From Remotion Ecosystem Research

**Jonny Burger's `whats-new-in-remotion` — the gold standard for multi-layer composition:**

```tsx
<AbsoluteFill>
  {/* Layer 1: A-roll */}
  <Video src={clip} trimBefore={silences[clip].leadingEnd} trimAfter={silences[clip].trailingStart} />
  
  {/* Layer 2: B-roll at specific timestamps */}
  <Sequence from={540} durationInFrames={120} layout="none">
    <VideoBRoll src="broll.mp4" />
  </Sequence>
  
  {/* Layer 3: Text overlays */}
  <LowerThird name="..." title="..." />
  
  {/* Layer 4: VFX */}
  <LightLeak />
  
  {/* Layer 5: Audio SFX */}
  <Audio src={whoosh} />
</AbsoluteFill>
```

Key details:
- `layout="none"` on B-roll `<Sequence>` — critical for overlay positioning
- `trimBefore`/`trimAfter` on `<Video>` for silence removal
- Pre-computed `SILENCES` map from FFmpeg `silencedetect`
- `<TransitionSeries>` with `<TransitionSeries.Overlay>` containing `<LightLeak>` + whoosh audio between scenes
- `calculateMetadata` for dynamic duration from trimmed clip lengths

**Caption rendering pipeline (`@remotion/captions`):**
1. Input: Whisper `Caption[]` with `{ text, startMs, endMs, confidence }`
2. Processing: `createTikTokStyleCaptions({ combineTokensWithinMilliseconds: 1800 })`
3. Rendering: Each `TikTokPage` in a `<Sequence>`, tokens highlighted by time

**B-roll insertion pattern:**
- `<Sequence from={frameNumber} durationInFrames={duration} layout="none">`
- `interpolate()` for fade in/out + Ken Burns zoom
- Timestamps from manual curation or Whisper word beats

**Preview vs. render:**
- Preview: `npx remotion studio` — hot-reload with timeline scrubber
- Render: `npx remotion render CompositionId output.mp4` — headless Chrome
- `<OffthreadVideo>` preferred over `<Video>` for final renders (better memory)
- `delayRender`/`continueRender` for async data loading before render

**Other notable repos:**
- `remotion-ai-video-factory` — `ShortTemplate.tsx` splits 9:16 into top scene (55%) + talking head (45%) + captions. Uses `createTikTokStyleCaptions()`.
- `github-unwrapped` (1,269 stars) — data-driven video with `calculateMetadata`, Zod schema for props validation, `Series.Sequence` with negative `offset` for overlap transitions.
- `revideo` (3,737 stars) — Remotion alternative for headless rendering as a function call, API deployment, generator-based scene flow.

---

## 2. Architectural Decisions for Our Video Editor

Based on all 4 research streams, here are the patterns we should adopt:

### Rendering Strategy: Hybrid (Matt Pocock pattern)
- Use Remotion for **overlay layers only** (captions, text animations, B-roll compositing)
- Use FFmpeg for **A-roll cutting, silence removal, final encoding**
- Render Remotion output as ProRes 4444 with alpha → FFmpeg composite
- This gives us Remotion's animation power without making it the bottleneck

### Composition Architecture: Config-Driven + Discriminated Unions (DigitalSamba v2)
- All editorial decisions live in a TypeScript config file
- Scene types as discriminated unions for type safety
- Claude Code edits config, not composition logic
- Smart transition defaults with per-scene overrides

### Multi-Layer Structure (Jonny Burger pattern)
```
Layer 1: A-roll (trimmed via silence detection)
Layer 2: B-roll (from indexed library, placed at transcript timestamps)
Layer 3: Captions (@remotion/captions with TikTok-style word highlighting)
Layer 4: Text animations (data points, key claims only)
Layer 5: VFX (light leaks at transitions)
Layer 6: Audio (background music, whoosh SFX)
```

### Transcript as Source of Truth (ButterCut + Jonny Burger)
- WhisperX for word-level timestamps
- Visual enrichment: extract key frames, Claude describes them
- B-roll markers: Claude identifies moments needing B-roll
- Silence map: FFmpeg silencedetect, stored as pre-computed JSON

### Intermediate Format: YAML Manifest (ButterCut pattern)
- Every editorial decision as human-readable YAML
- Inspectable, hand-editable, versionable
- Converts to Remotion config for rendering
- Converts to FCPXML/xmeml for NLE export (escape hatch)

### Pipeline Orchestration: Effect-TS Services (Matt Pocock pattern)
- Service-based DI with tagged errors
- Semaphore concurrency control per resource type
- Queue with dependencies and status tracking
- OpenTelemetry tracing for debugging overnight runs

### Skills Architecture: Progressive Disclosure (ButterCut + DigitalSamba)
- Skills ≤50 lines, delegate to adjacent scripts for complexity
- Parent/child parallelism with max concurrency
- Slash commands as workflow state machines
- Project reconciliation on resume

### Brand/Editorial Voice System (DigitalSamba + our adversarial idea)
- `config/brand.json` — visual identity (colors, fonts, spacing)
- `config/editorial-voice.md` — taste, vibe, anti-patterns (fed to Critic)
- `config/caption-styles.json` — typography for captions/overlays
- Brand → ThemeProvider → all components access via `useTheme()`

### Adversarial Quality Loop (our novel addition)
- Editor agent → generates Remotion config from transcript + B-roll index
- Critic agent → tears apart edit against editorial-voice.md (harsh, specific)
- Resolver agent → synthesizes valid criticisms into revised config
- Loop until Critic finds no substantive problems
- Autoresearch layer underneath for parameter optimization (silence thresholds, caption grouping, B-roll duration)

---

## 3. Tech Stack Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Transcription | WhisperX (local) | Word-level timestamps, free, Hindi support |
| Silence detection | FFmpeg silencedetect | Proven, configurable threshold |
| B-roll indexing | SQLite + JSON | ButterCut pattern, semantic search via embeddings |
| Composition | Remotion 4.x | Config-driven, React components, browser preview |
| Captions | @remotion/captions | Built-in TikTok-style, word-level highlighting |
| Transitions | Custom + @remotion/transitions | DigitalSamba's 7 + Remotion built-ins |
| A-roll processing | FFmpeg + NVENC | GPU-accelerated, frame-accurate |
| Final composite | FFmpeg overlay filter | ProRes 4444 alpha from Remotion |
| Pipeline orchestration | Effect-TS | Services, semaphores, tagged errors, tracing |
| Editorial judgment | Claude API | Editor/Critic/Resolver roles |
| Config format | TypeScript (Remotion) + YAML (manifest) | Type-safe editing + human-readable decisions |
| NLE export | FCPXML 1.8 + xmeml v5 | Escape hatch to FCP X / Premiere / Resolve |
| CLI | Commander.js | Matt Pocock pattern, global install |
| Brand system | JSON → ThemeProvider | DigitalSamba pattern |
| Skills | SKILL.md + slash commands | ButterCut + DigitalSamba patterns |

---

## 4. What Nobody Has Built Yet (Our Edge)

1. **Adversarial editorial loop** — Editor/Critic/Resolver with encoded taste. No existing project does this.
2. **Autoresearch parameter optimization** — Karpathy-style overnight improvement loop for edit quality. Novel application.
3. **Hindi/Hinglish-first pipeline** — All existing projects are English-only. Code-switching transcription is unsolved in this space.
4. **Existing B-roll library matching** — Most projects generate or manually place B-roll. Semantic matching against a large indexed library is rare.
5. **Combined Remotion overlay + FFmpeg backbone** — Matt Pocock does this but hasn't open-sourced the full pipeline as a reusable tool.
