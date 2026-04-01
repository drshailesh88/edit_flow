#!/usr/bin/env python3
"""
Face detection script for auto-reframe.

Samples frames from a video, detects faces using OpenCV's Haar cascade,
and outputs the average face center position as JSON.

Usage:
    python3 scripts/detect-face.py <video_path> [--samples N]

Output (JSON to stdout):
    {
        "face_detected": true,
        "center_x": 960,
        "center_y": 540,
        "avg_width": 200,
        "avg_height": 250,
        "detections": 8,
        "samples": 10
    }
"""

import sys
import json
import argparse
import cv2
import os


def detect_faces(video_path, num_samples=10):
    """Sample frames from video and detect face positions."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"Cannot open video: {video_path}"}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if total_frames <= 0:
        return {"error": "Cannot determine frame count"}

    # Load Haar cascade for face detection
    cascade_path = os.path.join(
        os.path.dirname(cv2.__file__), "data", "haarcascade_frontalface_default.xml"
    )
    if not os.path.exists(cascade_path):
        return {"error": f"Haar cascade not found at {cascade_path}"}

    face_cascade = cv2.CascadeClassifier(cascade_path)

    # Sample frames evenly across the video
    # Skip first and last 10% to avoid intro/outro
    start_frame = int(total_frames * 0.1)
    end_frame = int(total_frames * 0.9)

    if num_samples <= 0:
        cap.release()
        return {
            "face_detected": False,
            "center_x": width // 2,
            "center_y": height // 2,
            "avg_width": 0,
            "avg_height": 0,
            "detections": 0,
            "samples": 0,
            "frame_width": width,
            "frame_height": height,
        }

    sample_interval = max(1, (end_frame - start_frame) // num_samples)

    face_centers_x = []
    face_centers_y = []
    face_widths = []
    face_heights = []

    for i in range(num_samples):
        frame_idx = start_frame + i * sample_interval
        if frame_idx >= total_frames:
            break

        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(50, 50),
        )

        if len(faces) > 0:
            # Use the largest face (most likely the speaker)
            largest = max(faces, key=lambda f: f[2] * f[3])
            x, y, w, h = largest
            face_centers_x.append(x + w // 2)
            face_centers_y.append(y + h // 2)
            face_widths.append(w)
            face_heights.append(h)

    cap.release()

    if not face_centers_x:
        # No face detected — fall back to frame center
        return {
            "face_detected": False,
            "center_x": width // 2,
            "center_y": height // 2,
            "avg_width": 0,
            "avg_height": 0,
            "detections": 0,
            "samples": num_samples,
            "frame_width": width,
            "frame_height": height,
        }

    avg_cx = int(sum(face_centers_x) / len(face_centers_x))
    avg_cy = int(sum(face_centers_y) / len(face_centers_y))
    avg_w = int(sum(face_widths) / len(face_widths))
    avg_h = int(sum(face_heights) / len(face_heights))

    return {
        "face_detected": True,
        "center_x": avg_cx,
        "center_y": avg_cy,
        "avg_width": avg_w,
        "avg_height": avg_h,
        "detections": len(face_centers_x),
        "samples": num_samples,
        "frame_width": width,
        "frame_height": height,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect face position in video")
    parser.add_argument("video_path", help="Path to video file")
    parser.add_argument("--samples", type=int, default=10, help="Number of frames to sample")
    args = parser.parse_args()

    result = detect_faces(args.video_path, args.samples)
    print(json.dumps(result))
