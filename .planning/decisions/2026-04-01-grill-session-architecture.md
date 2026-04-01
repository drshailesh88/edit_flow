# Grill Session: Architecture Decisions
**Date:** 2026-04-01
**Source:** Interactive grill session in Claude Code
**Status:** captured

## Context
Stress-tested every architectural decision for the AI video editor pipeline. 19 questions asked and resolved. All decisions below are confirmed by the founder.

---

## INPUT DECISIONS

### Recording Setup
- **Camera:** Single cam, Canon 200D or OBS screen recording
- **Orientation:** Always 16:9 horizontal
- **Typical length:** ~30 minutes (rarely 2 hours)
- **Script:** Written with numbered sections (natural short boundaries)
- **Teleprompter:** Planned (iPhone/iPad/Mac overlay app)
- **Recording style:** Keep-rolling, re-say bad takes (no stop/start)
- **Take markers:** None reliable. Pipeline must detect bad takes purely from transcript analysis. Double clap suggested as optional bonus signal, not required.
- **Audio:** Rode USB pod mic (primary), lavalier available
- **Batch recording:** Preferred — weekend sessions, process overnight

### Bad Take Definition
A "bad" take is identified by:
- Stumbling / fumbling over words
- Losing train of thought (incomplete sentences, trailing off)
- Wrong terminology (corrected in the re-say)
- Bad pronunciation
- Bad tone (flat, uncertain, low energy)
- Background noise

**Heuristic:** When two versions of the same content exist, prefer the shorter, more confident, more fluent version.

---

## LANGUAGE DECISIONS

### Speech Pattern
- >50% Hindi, heavily code-switched (South Delhi Hinglish pattern)
- Switches languages mid-sentence frequently
- Business videos mostly in English

### Transcription Strategy
- Whisper locally on M2 Pro 16GB
- Start with `whisper-large-v3` with language detection per segment
- Fall back to `whisper-medium` or `whisper.cpp` if 16GB is too tight
- Benchmark both during build

### Caption Strategy: Transcreation (NOT Translation)
- Hindi/Hinglish content → English transcreation (meaning-preserving, natural English)
- English content → direct captions from transcript
- Claude performs transcreation (reasoning task, covered by Max)
- Goal: reach non-Hindi speakers via captions

---

## OUTPUT DECISIONS

### Content Types
1. **Long-form (16:9):** YouTube, Twitter. ~30 min.
2. **Shorts (9:16):** YouTube Shorts, Instagram Reels. <60 sec. Platform-agnostic, no labels.

### Shorts Extraction
- 7-8 shorts per long-form video (1 short posted daily)
- Each short = 1 complete thought (maps to numbered script sections)
- Shorts are standalone — independent stories, independent concepts
- Combining segments from different sections = rare edge case (manual in Resolve)
- No separate hook recording — hook comes from existing footage
- Long-form = trust/conversion backbone. Short-form = distribution/reach.

### Output Formats (Always Both)
| Format | Purpose |
|---|---|
| FCP XML (xmeml) | Open in Resolve with all layers for polish |
| MP4 | Final rendered video, ready to upload |

Both generated every time. User picks which to use. MP4 becomes default once pipeline is trusted. XML is the emergency escape hatch.

### Auto-Reframe
- 16:9 → 9:16 happens in code (not in an editor)
- Simple face detection + center crop (user is mostly seated, talking to camera)
- Build simple version first, upgrade only if results aren't good enough

### Metadata (Nice-to-Have)
- Suggested title, description, tags, chapter timestamps
- User handles final upload in YouTube Studio

---

## VISUAL TREATMENT DECISIONS

### Style: Huberman/Attia Authority Zone
- Visual restraint = authority
- No flashy animations, no influencer aesthetics
- Hard cuts, occasional dissolves
- No background music (audience feedback)
- No branded intro/outro (CTAs embedded in video)

### Remotion Layers (Shorts)
```
Layer 1: A-roll (talking head, silence-removed, best take, auto-reframed to 9:16)
Layer 2: B-roll cutaways (from SSD library, placed at topic-relevant moments)
Layer 3: English transcreated captions (sentences, lower third, moderate)
Layer 4: Term flashes + emphasis points (single component)
```

### Remotion Layers (Long-form)
```
Layer 1: A-roll (talking head, silence-removed, best take, 16:9)
Layer 2: B-roll cutaways (more aggressive — every 15-20 sec for retention)
Layer 3: Conservative captions (smaller, bottom, no animation)
Layer 4: Chapter title cards (between numbered sections)
Layer 5: Term flashes + emphasis points
```

### Caption Specs — Shorts
| Property | Value |
|---|---|
| Unit | Full sentence |
| Position | Lower third of screen |
| Size | Moderate — readable, not loud |
| Display | Always visible, sentence replaces sentence |
| Style A | White text on semi-transparent black box |
| Style B | Black text on semi-transparent white box |
| Selection | Auto-detect by scene brightness (FFmpeg luminance) |
| Keyword highlighting | Optional accent color on medical terms |
| Animation | None — appears, stays, replaces |

### Caption Specs — Long-form
| Property | Value |
|---|---|
| Unit | Full sentence |
| Position | Bottom of screen |
| Size | Smaller than shorts |
| Style | Standard subtitle |
| Animation | None |
| Keyword highlighting | No |

### Term Flash / Emphasis Specs
| Property | Value |
|---|---|
| Font | Clean sans-serif, regular weight, white |
| Background | Semi-transparent dark bar |
| Animation | Fade in/out, ~0.3s ease |
| Duration | 2-4 seconds (fast enough to disappear on context switch, slow enough to register) |
| Content | Technical/operative terms AND key emphasis points (one component) |
| Trigger | Claude identifies from transcript |
| Switchable | User can toggle caption type if it looks off-brand |

### B-roll Rules
| Long-form | Shorts |
|---|---|
| Aggressive — every 15-20 seconds | Selective — topic-relevant moments only |
| Medical imagery, anatomy, procedures, journal screenshots | Same content type, fewer clips |
| Hard cut transitions | Hard cut transitions |

---

## PROCESSING DECISIONS

### Pipeline Architecture — Two Tracks
**Track A (Primary — build first):**
```
Raw 16:9 → Whisper → Claude (take selection, shorts extraction, B-roll matching,
transcreation, term identification) → Remotion overlays → FFmpeg assembly → MP4 + XML
```

**Track B (Experimental — build second):**
```
Raw 16:9 → Whisper → Claude decisions → Python scripts drive Resolve API → Resolve renders
```

**Whichever gives the fast win becomes the default.** Both share the same analysis/intelligence layer.

### Adversarial Loop
- **Critic evaluates JSON manifest + transcript** (no render per round)
- 3 rounds default, 5 max before yellow flag
- Final render happens ONCE after loop converges
- Priority stack: cut placement > bad take removal > B-roll placement > B-roll appropriateness > term flash placement > caption quality

### Timing Per Video (~1.5 hours)
```
Whisper transcription: ~10 min
Take selection + shorts extraction: ~5 min
B-roll matching: ~5 min
Adversarial loop (3 rounds × 8 shorts): ~52 min
Long-form adversarial + render: ~20 min
Shorts rendering (8 × 2 min): ~16 min
Total: ~87 min ≈ 1.5 hours
```

### Overnight Capacity
- M2 Pro 16GB, daily driver, runs overnight
- Sequential processing (16GB too tight for parallel Whisper + Remotion)
- 10-hour window = 6-7 videos per night
- Batch recording weekends → queue all → process overnight → ready by morning

### Confidence Tagging
| Tag | Meaning | Action |
|---|---|---|
| GREEN | Auto-approved, high confidence | Upload directly |
| YELLOW | Review recommended | Check before uploading |
| RED | Review required | Something went wrong, fix needed |

---

## B-ROLL DECISIONS

### Library
- Hundreds of clips (not thousands) — manageable
- Stock footage, downloaded over time
- Medical/cardiology content — limited visual vocabulary, good coverage
- Organized by topic in folders (chaptered)
- Mixed formats: MP4/MOV, 1080p/4K
- Mostly static library — not frequently growing
- Lives on external SSD, always connected during overnight runs

### Indexing Strategy
- SQLite database in project directory (~5MB)
- One keyframe extracted per clip (FFmpeg, free)
- Claude describes each clip during indexing (covered by Max)
- Fields: path, folder, description, tags, duration, resolution, format
- Incremental updates for new clips (`/index-new-broll`)
- No vector embeddings needed — folder names + descriptions sufficient for Claude matching

### Matching Strategy
- Claude reads transcript segment → identifies B-roll moment
- Searches index by topic folder + description
- No AI generation — flag gaps for manual sourcing
- $0 operational cost

---

## INFRASTRUCTURE DECISIONS

### Interface
- Claude Code skills (slash commands) for interactive work
- Simple Node.js CLI for queue/batch processing
- No separate app, no web UI

### Machine
- M2 Pro 16GB MacBook Pro (daily driver)
- SSD for B-roll (always connected during overnight runs)
- Sequential processing to stay within 16GB

### Cost Structure
| Item | Cost |
|---|---|
| Claude Max | Already paying |
| Whisper | $0 (local) |
| FFmpeg/Remotion | $0 (local) |
| B-roll indexing | ~$0 (Claude Max) |
| Resolve Studio (Track B only) | $295 one-time |
| **Marginal cost per video** | **$0** |

### Brand Profiles
```
config/brands/
├── medical-practice/
│   ├── editorial-voice.md
│   ├── brand.json
│   ├── caption-style.json
│   └── broll-filter.json
├── business-coaching/
│   └── ...
```

Each brand gets its own Critic prompt, caption style, and B-roll filter.

---

## RESOLVE INTEGRATION DECISIONS

### DaVinci Resolve Role
- **NOT in the main automated pipeline** (Track A)
- **Emergency escape hatch:** open FCP XML in Resolve for manual fixes (<5% of videos)
- **Track B (experimental):** Claude drives Resolve via MCP server (samuelgursky/davinci-resolve-mcp, 739 stars)
- **Requires:** Resolve Studio ($295) for scripting API access

### MCP Server Option
- samuelgursky/davinci-resolve-mcp: 27 compound tools, 342 granular tools
- Covers full API + Fusion
- Early beta (<1 year old), actively maintained
- Configure in `.mcp.json` if/when pursuing Track B

### Proven Prior Art
- Matt Pocock: Two-track system (FFmpeg+Remotion for shorts, Resolve for long-form)
- auto-subs: 3,013 stars, production-ready subtitle → Resolve integration
- pydavinci: 173 stars, best Python wrapper for Resolve API

---

## REFERENCE ARCHITECTURE: MATT POCOCK'S PIPELINE

Matt Pocock uses the same two-track architecture we're building:

**His Track A (automated shorts):**
OBS → FFmpeg silence detection (-38dB) → bad take filter (OBS chapter markers) → FFmpeg single-pass concatenation (NVENC GPU) → audio normalization (-16 LUFS) → Whisper transcription → Remotion transparent subtitle overlay (ProRes 4444) → FFmpeg composite → MP4

**His Track B (manual long-form):**
OBS → same silence detection + bad take filter → clips sent to Resolve via Lua scripts → manual editing → Resolve renders

**Key patterns adopted from Matt:**
- Remotion renders ONLY overlays (not full video)
- Mutex ensures 1 Remotion render at a time
- Semaphore concurrency control per resource type
- Effect-TS services with tagged errors
- Queue system with item dependencies

**Our extensions beyond Matt's system:**
- Adversarial Editor/Critic/Resolver quality loop
- B-roll automation from indexed library
- Hindi/Hinglish transcreation
- Brand profiles for multiple businesses
- Term flash overlays
- Auto-reframe in code
- Claude-driven Resolve as experimental Track B
