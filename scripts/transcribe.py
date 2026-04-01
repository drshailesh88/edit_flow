#!/usr/bin/env python3
"""
Transcribe audio using OpenAI Whisper locally.
Outputs word-level timestamps as JSON to stdout.

Usage: python3 scripts/transcribe.py <video_or_audio_path> [--model medium] [--language hi]
"""

import sys
import json
import argparse
import whisper


def transcribe(file_path, model_name="medium", language=None):
    """Transcribe a file and return segments with word-level timestamps."""
    model = whisper.load_model(model_name)

    # word_timestamps=True gives us per-word timing
    result = model.transcribe(
        file_path,
        language=language,
        word_timestamps=True,
        verbose=False,
    )

    segments = []
    for seg in result["segments"]:
        words = []
        for w in seg.get("words", []):
            words.append({
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            })

        segments.append({
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": seg["text"].strip(),
            "words": words,
        })

    return {
        "language": result.get("language", language or "unknown"),
        "segments": segments,
    }


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with Whisper")
    parser.add_argument("file", help="Path to video or audio file")
    parser.add_argument("--model", default="medium", help="Whisper model size (tiny, base, small, medium, large)")
    parser.add_argument("--language", default=None, help="Language code (e.g., hi for Hindi, en for English)")
    args = parser.parse_args()

    result = transcribe(args.file, model_name=args.model, language=args.language)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()  # trailing newline


if __name__ == "__main__":
    main()
