# Planning Session: AI Video Editor for Hindi/Hinglish/English Content
**Date:** 2026-04-01
**Source:** Claude.ai
**Status:** captured

## Context
_Building a code-first AI video editor for long-form and short-form Hindi/Hinglish/English videos. The founder is an interventional cardiologist who builds with Claude Code and Codex, has shipped document editors and a LaTeX editor, and has a large existing B-roll library on SSD. The goal is a pipeline that automates video post-production — transcription, silence removal, best-take selection, B-roll matching, captions, text animations — with an adversarial quality loop._

## Key Decisions Made

1. **Remotion (Approach 3) as the rendering framework** — Video is a React component, every layer is a code object, Claude Code can surgically edit any element. Rejected: raw FFmpeg-only pipeline (no preview, no component model), EDL/timeline export to NLE (gives up code-first control), JSON manifest without Remotion (loses browser preview and React composability).

2. **B-roll selection from existing library, not AI generation** — Index the SSD library once using a vision model (Claude/Gemini to describe frames), store as JSON/SQLite, match by semantic similarity at edit time. Rejected: AI video generation (expensive, slow, unnecessary when library exists).

3. **Adversarial LLM architecture with 3 roles (Editor / Critic / Resolver)** — Editor generates the Remotion composition, Critic tears it apart against editorial standards, Resolver synthesizes valid criticisms into a revised composition. Loop runs until Critic can't find substantive problems. Rejected: single scoring function (gives numbers not reasons), literal GAN (operates on pixels, wrong tool for editorial judgment), single-pass LLM edit (no quality iteration).

4. **Karpathy autoresearch-style optimization for parameters** — Silence thresholds, caption grouping size, B-roll duration, pacing parameters optimized via generate-render-score-modify loop running overnight. Layered optimization (B-roll first, then pacing, then captions, then full composite). Rejected: manual parameter tuning (slow, inconsistent), monolithic single-loop optimization (too slow per iteration).

5. **Claude Code skills as the interface** — Each pipeline stage is a slash command (/ingest, /silence, /best-take, /broll-match, /captions, /text-anim, /assemble, /critique, /refine, /full-pipeline). No separate application UI. Rejected: building a web UI (10x complexity), CLI scripts without Claude Code integration (loses conversational editing).

6. **Editorial voice document as the core competitive advantage** — A markdown file encoding the founder's taste, brand positioning, vibe rules, and anti-patterns. Fed to the Critic's system prompt. This is what makes the adversarial loop produce edits that match the founder's specific style, not generic YouTube edits.

7. **JSON manifest as the intermediate representation** — Every edit decision is captured in a readable, modifiable format before rendering. Enables conversational revision ("swap the B-roll at 0:15 for something about stents"). Rejected: rendering final MP4 first then trying to fix (worst approach — always keep edit decisions separate from render).

## Open Questions

- [ ] Which Whisper variant to use — WhisperX (better word-level timestamps) vs standard Whisper vs API?
- [ ] Hindi/Hinglish transcription quality — does Whisper handle code-switching well enough, or need a specialized model?
- [ ] B-roll library indexing strategy — JSON file vs SQLite vs vector DB for semantic search?
- [ ] Scoring function design — how exactly to define "good edit" as a composite metric (LLM judge + rules-based checker)?
- [ ] Remotion rendering speed — is low-res preview fast enough for overnight optimization loops (5-10 min per render)?
- [ ] How to handle multi-language captions (Hindi/Hinglish/English) in the same video?
- [ ] Local GPU vs cloud GPU for Whisper transcription on longer videos?
- [ ] Git-based version control for edit iterations — how to track the autoresearch experiment history?

## Constraints & Requirements

- **Code-first**: No traditional NLE dependency. Everything runs from Claude Code directory.
- **Trilingual**: Must handle Hindi, Hinglish (Hindi-English code-switching), and English content.
- **Existing B-roll library**: Large collection on SSD — system must index and select from it, not generate new.
- **Low operational cost**: ~$1-3 per video for personal use (Whisper local, LLM API calls only for judgment).
- **Overnight autonomy**: The adversarial loop and autoresearch optimization must run unattended.
- **Editorial control**: The founder's taste and brand voice must be encoded and enforced, not generic.
- **Iterative refinement**: Must be able to give natural language feedback and re-edit without re-processing entire video.

## Architecture Summary

### Pipeline Stages
1. **Ingest** — Extract audio, run Whisper transcription with word-level timestamps
2. **Silence removal** — Filter pauses by duration threshold from Whisper timestamps
3. **Best-take selection** — LLM picks best take from transcript segments
4. **B-roll matching** — LLM reads transcript, matches moments to indexed B-roll library
5. **Captions** — Map Whisper timestamps to styled text overlays
6. **Text animations** — Place data points and key claims as motion graphics
7. **Assembly** — Remotion composition rendering all layers
8. **Critique** — Adversarial LLM tears apart the edit against editorial voice
9. **Resolve** — Synthesis LLM applies valid criticisms
10. **Optimize** — Autoresearch loop for parameter tuning overnight

### Three-Role Adversarial System
- **Editor** (creative mode) — Bold creative choices, generates Remotion composition
- **Critic** (adversarial mode) — Harsh, specific, flags vibe mismatches and amateur patterns
- **Resolver** (synthesis mode) — Decides which criticisms are valid, produces revised composition

### Project Structure
```
video-pipeline/
├── .claude/
│   └── skills/
│       ├── ingest/SKILL.md
│       ├── silence/SKILL.md
│       ├── best-take/SKILL.md
│       ├── broll-match/SKILL.md
│       ├── captions/SKILL.md
│       ├── text-anim/SKILL.md
│       ├── assemble/SKILL.md
│       ├── critique/SKILL.md
│       ├── refine/SKILL.md
│       └── full-pipeline/SKILL.md
├── config/
│   ├── editorial-voice.md
│   ├── caption-styles.json
│   └── broll-index.json
└── CLAUDE.md
```

### Reference Projects
- **ButterCut** (github.com/barefootford/buttercut) — 180 stars, Claude Code skills, WhisperX, exports timelines for DaVinci/Premiere
- **Chris Lema's pipeline** — 8 markdown skills, FFmpeg + Whisper, zero application code
- **DigitalSamba Video Toolkit** (github.com/digitalsamba/claude-code-video-toolkit) — Remotion integration, brand profiles
- **VidPipe** (htekdev) — 8 specialized AI agents, built in 3 weeks

## Estimated Timeline

| Weekend | Deliverable |
|---------|-------------|
| 1 | Whisper transcription + silence removal + captions + FFmpeg export |
| 2 | Best-take selection + B-roll library indexing & matching + Remotion setup |
| 3 | Editorial voice document + Critic prompt + Editor-Critic-Resolver loop |
| 4 | Wire up adversarial loop end-to-end + JSON manifest system |
| 5 | Autoresearch-style parameter optimization layer |

## Next Steps

- [ ] Set up the Claude Code project directory with skill scaffolding
- [ ] Write the editorial voice document (founder's taste encoded as rules)
- [ ] Index the existing B-roll library on SSD
- [ ] Build /ingest skill (Whisper transcription with word-level timestamps)
- [ ] Test Hindi/Hinglish transcription quality with real footage
- [ ] Clone ButterCut and Chris Lema skills as references

## Raw Notes

### Q: How difficult and costly is it to build?

Difficulty: Very doable — maybe 3-4 weekends for the MVP. The core architecture is a pipeline: Whisper transcription (easiest part, local, free), intelligent silence removal (straightforward logic on timestamps), best-take selection via LLM (simple prompt engineering), caption generation (mapping timestamps to styled overlays), FFmpeg assembly (40% of debugging effort).

Operational costs per video: ~$1-3. Whisper locally $0, Gemini/Claude API ~$0.50-$2, cloud GPU ~$0.50-$1/hr if no local GPU.

Not building a real-time NLE like Premiere — building a batch processing pipeline. Orders of magnitude simpler. MVP: 2,000-3,000 lines of Python. Full production app with UI: 10x.

### Q: What about using existing B-roll library instead of generating?

Simplifies massively. Index library once with vision model → JSON/SQLite. Per-video matching is pennies. B-roll indexing one-time cost: $5-15 depending on library size. Hardest task: FFmpeg timeline assembly with B-roll insertions (fiddly, not conceptually hard).

### Q: Have people built this with Claude Code?

Yes — ButterCut (180 stars, full Claude Code skills pipeline), Chris Lema (8 markdown files, zero application code, typed one command and went to lunch), DigitalSamba (Remotion integration), VidPipe (8 AI agents, 3 weeks).

### Q: How to handle multi-layer editing and revisions?

Three approaches: (1) EDL/timeline export to NLE, (2) JSON manifest with conversational editing, (3) Remotion — video as React components. Decision: go hard on Approach 3 (Remotion) because already using code-first tools.

### Q: Can we use GAN/adversarial concepts and Karpathy autoresearch?

GAN instinct is right but wrong tool — editorial judgment is a language/reasoning task, not pixel generation. What's actually wanted: adversarial LLM with Editor/Critic/Resolver roles. Critic doesn't score — it attacks. Loaded with editorial standards, brand voice, examples of loved/hated edits.

Karpathy autoresearch maps perfectly: define good edit criteria in markdown, Remotion composition as the "train.py", scoring function as the "val_bpb". Loop: generate → render preview → score → modify → repeat overnight. Optimize in layers (B-roll → pacing → captions → full composite).

The Critic's system prompt is the competitive advantage — encodes specific taste and vibe that no one else has.

### Q: Can we build custom slash commands?

Yes — each pipeline stage becomes a SKILL.md file. /ingest, /silence, /best-take, /broll-match, /captions, /text-anim, /assemble, /critique, /refine, /full-pipeline. CLAUDE.md ties it all together. context:fork for Critic to avoid polluting Editor context. Weekend-one task to scaffold.
