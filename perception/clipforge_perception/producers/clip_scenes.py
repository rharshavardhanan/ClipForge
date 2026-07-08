"""CLIP scene labels + embeddings (Phase 1d) — the `scenes` layer with a real visual label
per scene-cut segment and a per-scene image embedding written as a sidecar
(<out_dir>/clip/<i>.f32, little-endian f32, referenced by embedding_ref).

Model: open_clip ViT-B-32 / 'openai' weights (zero-shot over SCENE_LABELS)."""

from __future__ import annotations

import struct
import tempfile
from pathlib import Path

from .. import ffmpeg
from ..schema import Scene, scene_to_dict
from .base import Ctx

MODEL_NAME = "ViT-B-32"
PRETRAINED = "openai"
PROMPT = "a video frame of {}"
MIN_SCENE_SEC = 0.05

# Zero-shot label bank tuned to creator content — natural phrases on purpose: Node's Slice B
# topic fallback ignores generic /^scene \d+$/ labels (the mock's), so these must never look
# like that.
SCENE_LABELS = [
    "a podcast studio conversation", "an interview on stage", "a person talking to the camera",
    "a gaming screen with gameplay", "a live stream reaction facecam", "a gym workout",
    "a sports arena or stadium", "a basketball court", "a soccer field",
    "a street interview outdoors", "a busy city street", "a car interior",
    "a cooking kitchen", "a restaurant meal", "an outdoor vlog in nature",
    "a beach or pool", "a stage performance or concert", "a crowd celebrating",
    "a classroom or lecture", "an office desk with a computer", "a whiteboard presentation",
    "a boxing or mma fight", "people laughing together", "a person crying or emotional",
    "a product unboxing on a table", "money or cash on display", "a luxury car exterior",
    "a private jet or airport", "a hospital or medical setting", "a courtroom",
    "an animated cartoon", "a screenshot of a phone app", "text on a plain background",
]


def spans_from_cuts(cuts: list[float], duration: float) -> list[tuple[float, float]]:
    """PURE: cut times → (start, end) scene spans, slivers under MIN_SCENE_SEC dropped."""
    bounds = [0.0, *sorted(t for t in cuts if 0.0 < t < duration), duration]
    spans = [
        (round(bounds[i], 3), round(bounds[i + 1], 3))
        for i in range(len(bounds) - 1)
        if bounds[i + 1] - bounds[i] > MIN_SCENE_SEC
    ]
    return spans or [(0.0, round(duration, 3))]


def pick_label(sims: list[float], labels: list[str]) -> str:
    """PURE: argmax similarity → label."""
    best = max(range(len(sims)), key=lambda i: sims[i])
    return labels[best]


def write_embedding(path: str, vec) -> None:
    """Write a little-endian f32 sidecar (creates parent dirs)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    floats = [float(x) for x in vec]
    p.write_bytes(struct.pack(f"<{len(floats)}f", *floats))


def _load_model():
    import open_clip  # lazy: torch import only when selected

    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model.eval()
    return model, preprocess, tokenizer


def warm() -> str:
    _load_model()
    return f"clip: {MODEL_NAME}/{PRETRAINED} ready"


class ClipScenesProducer:
    name = "clip"

    def run(self, video: str, ctx: Ctx) -> dict:
        import torch
        from PIL import Image

        model, preprocess, tokenizer = _load_model()
        with torch.no_grad():
            text_feat = model.encode_text(tokenizer([PROMPT.format(l) for l in SCENE_LABELS]))
            text_feat /= text_feat.norm(dim=-1, keepdim=True)

        spans = spans_from_cuts(ffmpeg.scene_cut_times(video), ctx.duration)
        scenes: list[dict] = []
        with tempfile.TemporaryDirectory() as td:
            for i, (start, end) in enumerate(spans):
                frame = ffmpeg.extract_frame(video, (start + end) / 2, f"{td}/{i}.jpg")
                # Close each frame's file handle — hundreds of scenes would otherwise pile up
                # open fds and hit the macOS soft limit mid-loop (producer then fails every run).
                with Image.open(frame) as im:
                    image = preprocess(im).unsqueeze(0)
                with torch.no_grad():
                    feat = model.encode_image(image)
                    feat /= feat.norm(dim=-1, keepdim=True)
                sims = (feat @ text_feat.T).squeeze(0).tolist()
                ref = f"clip/{i}.f32"
                write_embedding(str(Path(ctx.out_dir) / ref), feat.squeeze(0).tolist())
                scenes.append(scene_to_dict(Scene(
                    start=start, end=end,
                    label=pick_label(sims, SCENE_LABELS), embedding_ref=ref,
                )))
        return {"scenes": scenes}
