# Requirements — AI Video Editor Pipeline

## Version
v1 — AI Video Editor Pipeline (Track A: Pure Code)

## Must Have (v1)

### Ingest & Transcription
- [x] Pipeline accepts a raw 16:9 Recording (~30 min) and produces a Transcript with word-level timestamps
- [x] Whisper runs locally on M2 Pro 16GB without crashing or exceeding memory
- [ ] Hindi/Hinglish code-switching is transcribed with acceptable accuracy (benchmark against known recordings)

### Take Selection
- [ ] Bad Takes are automatically detected from Transcript analysis (stumbling, incomplete sentences, wrong terminology followed by corrections)
- [ ] When multiple Takes of the same Section exist, the shorter, more confident, more fluent version is selected as Best Take
- [x] All silence gaps beyond a threshold are removed from the final output

### Shorts Extraction
- [ ] Numbered Section boundaries in the Transcript are identified and used to define 7-8 Shorts per Recording
- [ ] Each Short contains exactly one complete standalone thought (one Section)
- [ ] Each Short is <60 seconds

### B-roll System
- [ ] B-roll Library on SSD is indexed into a SQLite database with descriptions per clip
- [ ] Indexing is incremental — only new clips are processed on subsequent runs
- [ ] B-roll is automatically Matched to transcript moments by topic relevance
- [ ] Long-form videos get aggressive B-roll (every 15-20 seconds)
- [ ] Shorts get selective B-roll (topic-relevant moments only)
- [ ] Pipeline flags Yellow (not inserts irrelevant footage) when no suitable Match exists

### Captions (Transcreation)
- [ ] Hindi/Hinglish speech is transcreated into natural English Captions preserving meaning and intent
- [ ] English speech produces direct Captions from Transcript
- [ ] Short Captions: full sentences, lower third, moderate size, always visible, no animation
- [ ] Long-form Captions: smaller, bottom of screen, no animation
- [ ] Two Caption presets available: white-on-black and black-on-white
- [ ] Caption preset auto-selected by scene brightness (FFmpeg luminance analysis)
- [ ] Creator can manually switch Caption preset per video

### Term Flashes
- [ ] Technical and operative medical terms are identified from Transcript
- [ ] Key claims and statistics are identified as emphasis points
- [ ] Term Flashes appear on screen: clean sans-serif, white text, semi-transparent dark background, fade in/out 0.3s, hold 2-4 seconds
- [ ] Term Flashes are positioned to avoid collision with Captions

### Chapter Titles (Long-form only)
- [ ] Chapter Title cards appear between Sections in Long-form videos
- [ ] Chapter Titles are derived from numbered script section headings

### Adversarial Quality Loop
- [ ] Editor agent generates initial Manifest from Transcript + B-roll Index
- [ ] Critic agent evaluates Manifest against Editorial Voice document (cut placement, take selection, B-roll placement, term flash placement)
- [ ] Resolver agent synthesizes valid criticisms into a revised Manifest
- [ ] Loop runs 3 Rounds by default, up to 5 max
- [ ] Critic evaluates Manifest JSON + Transcript only (no rendered preview per Round)

### Rendering (Track A)
- [ ] Remotion renders Captions + Term Flashes + Chapter Titles as transparent ProRes 4444 overlay
- [ ] FFmpeg assembles A-roll cuts, B-roll insertions, and Remotion overlay into final MP4
- [ ] Audio is normalized (loudnorm)
- [ ] Only 1 Remotion render runs at a time (mutex)
- [ ] Pipeline runs sequentially to stay within 16GB

### Auto-Reframe
- [ ] 16:9 Recordings are auto-reframed to 9:16 for Shorts using face-detection center crop
- [ ] Creator's face stays centered in vertical format

### Output
- [ ] Every output (Long-form + each Short) produces both MP4 and FCP XML (xmeml)
- [ ] FCP XML maps layers to tracks: V1=A-roll, V2=B-roll, V3=Captions, V4=Term Flashes
- [ ] FCP XML is compatible with DaVinci Resolve (free) and FCPX
- [ ] Frame-accurate timecodes in XML

### Confidence & Review
- [ ] Every output is tagged Green, Yellow, or Red
- [ ] Green: adversarial loop converged in ≤3 Rounds, no flags
- [ ] Yellow: loop converged in 4-5 Rounds, or specific flags (no B-roll match, ambiguous take, SSD disconnected)
- [ ] Red: render failed, transcript unusable, Whisper confidence below threshold

### Queue & Batch Processing
- [ ] Multiple Recordings can be queued for sequential overnight processing
- [ ] Queue tracks status per Recording: ready → processing → done/failed
- [ ] Pipeline processes 6-7 Recordings in a 10-hour overnight window
- [ ] Creator can review Queue status with confidence tags via /review-queue

### Brand System
- [ ] Separate Brand profiles with distinct Editorial Voice, caption style, and B-roll filter
- [ ] Critic loads the correct Editorial Voice for the active Brand
- [ ] At least 2 Brands supported (medical practice + business coaching)

### Interface
- [ ] Pipeline is operated through Claude Code slash commands
- [ ] /ingest, /process, /full-pipeline, /critique, /review-queue, /fix commands available
- [ ] /fix accepts natural language instruction and updates Manifest + re-renders one Short
- [ ] CLAUDE.md provides project context to Claude Code on every session

### Visual Style
- [ ] Output looks like Huberman/Attia — clean, authoritative, minimal
- [ ] Hard cuts only (no flashy transitions)
- [ ] No background music, no branded intro/outro
- [ ] Shorts are platform-agnostic (no labels, no watermarks)

## Should Have (v1.1)

- [ ] Suggested YouTube metadata (title, description, tags, chapter timestamps) per Recording
- [ ] Optional keyword highlighting in Captions (medical terms in accent color)
- [ ] Graceful SSD disconnection handling (complete intelligence work, flag Yellow for render later, resume with /render-pending)
- [ ] Track B: Claude drives DaVinci Resolve via MCP scripting API as alternative renderer

## Out of Scope

- Web UI or desktop app
- Mobile app or mobile recording integration
- YouTube/social media upload automation
- Thumbnail generation
- AI-generated B-roll
- Real-time editing or live preview during pipeline execution
- Multi-user collaboration
- Cloud processing or deployment
- Voice cloning, eye contact correction, green screen
- Podcast-specific features
- Platform-specific video customization
- Combining Sections from different parts of Recording into one Short
- Background music, branded intros/outros
- Analytics or performance tracking

## Source
PRD: .taskmaster/docs/prd.txt
Planning decisions: .planning/decisions/2026-04-01-grill-session-architecture.md
Competition research: .planning/competition-research.md
Reference architecture: .planning/reference-architecture.md
Domain language: UBIQUITOUS_LANGUAGE.md
