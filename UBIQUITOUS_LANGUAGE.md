# Ubiquitous Language

## Content Hierarchy

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Recording** | A single raw video file captured in one continuous session (~30 min, 16:9) | Footage, raw, source, input |
| **Long-form** | The final edited horizontal video (16:9) derived from one Recording, published on YouTube/Twitter | Full-length, main video, horizontal |
| **Short** | A standalone vertical video (9:16, <60 sec) containing one complete thought, derived from a Long-form | Clip, reel, vertical video, short-form |
| **Section** | A numbered division in the script that maps to one complete thought; the natural boundary for extracting a Short | Segment, point, chapter, thought, block |
| **Take** | One attempt at delivering a Section; a Recording may contain multiple Takes of the same Section | Version, attempt, re-say, redo |
| **Bad Take** | A Take rejected due to stumbling, wrong terminology, bad pronunciation, bad tone, or noise | Outtake, flub, mistake |
| **Best Take** | The Take selected for the final output — typically the shorter, more confident, more fluent version | Good take, selected take, keeper |

## Layers

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **A-roll** | The primary talking-head footage of the speaker | Main footage, talking head, primary video |
| **B-roll** | A supplementary video clip from the library, inserted as a cutaway over the A-roll | Cutaway, overlay, insert, stock footage |
| **Caption** | English transcreated text displayed on screen representing what the speaker means (not word-for-word translation) | Subtitle, sub, text |
| **Term Flash** | A text overlay that appears when a technical or operative term is spoken, or when a key claim/statistic deserves emphasis | Lower third, text animation, emphasis, keyword popup |
| **Chapter Title** | A text card displayed between Sections in a Long-form video | Section title, title card, divider |

## B-roll System

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Library** | The complete collection of B-roll clips stored on the external SSD, organized by topic folders | Archive, media library, footage collection |
| **Index** | The SQLite database in the project directory containing metadata, descriptions, and paths for every clip in the Library | Catalog, database, registry |
| **Match** | The act of Claude selecting a B-roll clip from the Index based on transcript context | Selection, lookup, search, pick |

## Pipeline

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Pipeline** | The complete automated system from raw Recording to final output (MP4 + XML) | Workflow, process, system, flow |
| **Ingest** | The first pipeline stage: extract audio, run Whisper transcription, produce word-level timestamps | Import, process, load |
| **Manifest** | The JSON document describing every editorial decision (cuts, B-roll placements, caption assignments, term flashes) before any rendering occurs | Config, composition, edit decision list, timeline |
| **Render** | The act of producing a final video file from a Manifest using Remotion + FFmpeg | Export, encode, build, compile |
| **Queue** | The JSON-based job list that tracks multiple Recordings through the Pipeline with status and dependencies | Batch, job list, task list |

## Adversarial Loop

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Editor** | The Claude agent role that generates the initial Manifest from transcript and B-roll Index | Generator, creator, composer |
| **Critic** | The Claude agent role that attacks the Manifest for problems: wrong cuts, bad B-roll choices, misplaced term flashes, kept bad takes | Judge, scorer, reviewer, evaluator |
| **Resolver** | The Claude agent role that reads the Critic's objections, decides which are valid, and produces a revised Manifest | Fixer, synthesizer, mediator |
| **Round** | One cycle of Editor → Critic → Resolver producing an improved Manifest | Iteration, pass, loop |
| **Convergence** | When the Critic finds no substantive problems and the loop stops (default: 3 rounds, max: 5) | Done, resolved, settled |

## Transcription

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Transcript** | The Whisper-generated text with word-level timestamps from a Recording's audio | Transcription, caption file, text |
| **Transcreation** | Recreating the Hindi/Hinglish meaning in natural English — preserving intent and context, not translating word-for-word | Translation, localization, subtitling |

## Rendering Tracks

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Track A** | The primary rendering path: Remotion overlays + FFmpeg assembly, fully autonomous, no external dependencies | Code pipeline, automated path |
| **Track B** | The experimental rendering path: Claude drives DaVinci Resolve via Python/MCP scripting API | Resolve pipeline, manual path |
| **Escape Hatch** | Opening the FCP XML output in Resolve or FCPX for manual fixes when the Pipeline output isn't right | Fallback, manual override, editor fix |

## Confidence & Review

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Green** | Pipeline output that passed adversarial review with high confidence — auto-approved for upload | Ready, done, approved |
| **Yellow** | Pipeline output that needs human review before upload (e.g., ambiguous take, missing B-roll, loop didn't converge) | Warning, review, check |
| **Red** | Pipeline output with a failure requiring manual intervention (e.g., render failed, transcript unusable) | Error, failed, broken |

## Brand System

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Brand** | A named configuration profile for a specific business/practice, containing editorial voice, visual style, caption preferences, and B-roll filter | Business, practice, channel, profile |
| **Editorial Voice** | A markdown document encoding the founder's taste, vibe rules, and anti-patterns for a specific Brand — fed to the Critic's system prompt | Style guide, tone guide, brand voice, taste document |

## Relationships

- A **Recording** produces exactly one **Long-form** and 7-8 **Shorts**
- A **Recording** contains multiple **Sections** (defined by the numbered script)
- Each **Section** contains one or more **Takes** (from keep-rolling re-says)
- Each **Short** maps to one **Section** (combining Sections is a rare edge case)
- A **Manifest** describes one output video (one Manifest per Short, one per Long-form)
- The **Editor** produces a **Manifest**, the **Critic** attacks it, the **Resolver** revises it — this is one **Round**
- A **Brand** determines which **Editorial Voice** the **Critic** uses
- A **Match** connects a **Transcript** moment to a **Library** clip via the **Index**
- Every output gets exactly one confidence tag: **Green**, **Yellow**, or **Red**

## Example dialogue

> **Dev:** "When a new Recording is ingested, how many Manifests get created?"
>
> **Founder:** "One per output. So for a typical 30-min Recording, the Pipeline creates one Long-form Manifest and 7-8 Short Manifests — one per Section."
>
> **Dev:** "And the adversarial loop runs on each Manifest independently?"
>
> **Founder:** "Yes. The Editor generates each Short's Manifest separately. The Critic evaluates each one against the Editorial Voice for that Brand. If the Critic flags the B-roll Match at 0:15 as wrong, the Resolver fixes that specific Manifest. Three Rounds max per Short."
>
> **Dev:** "What if the Critic still has problems after 5 Rounds?"
>
> **Founder:** "That Short gets tagged Yellow. I review it in the morning. If the Manifest is fine but the Render looks off, I open the XML in Resolve via the Escape Hatch."
>
> **Dev:** "And the Long-form — same loop?"
>
> **Founder:** "Same loop, but more B-roll Matches because Long-form uses B-roll aggressively — every 15-20 seconds. The Chapter Titles between Sections are auto-generated from the script's numbered headings."

## Flagged ambiguities

- **"Clip"** was used to mean both a B-roll file from the Library AND a Short extracted from the Long-form. Resolved: **B-roll** for library footage, **Short** for extracted vertical videos. Avoid "clip" entirely.

- **"Caption" vs "Subtitle"** were used interchangeably. Resolved: **Caption** is the canonical term (English transcreated text on screen). Avoid "subtitle" — it implies direct translation, not transcreation.

- **"Lower third" vs "Term flash" vs "Text animation"** were initially three separate concepts, then merged. Resolved: **Term Flash** is one unified component for both technical terms and emphasis points. Avoid "lower third" (implies a specific screen position) and "text animation" (implies motion that we don't want).

- **"Composition" vs "Manifest" vs "Config"** were used interchangeably for the edit decision document. Resolved: **Manifest** is the JSON document of editorial decisions. "Composition" refers specifically to the Remotion React component that renders from a Manifest. Avoid using "composition" for the decision document.

- **"Pipeline" vs "Workflow" vs "Process"** were used interchangeably. Resolved: **Pipeline** is the canonical term for the complete automated system. Avoid "workflow" (too vague) and "process" (too generic).

- **"Section" vs "Segment" vs "Chapter"** were used for script divisions. Resolved: **Section** for script divisions (input), **Chapter Title** for the on-screen card between sections (output). Avoid "segment" (ambiguous) and "chapter" when referring to script structure.
