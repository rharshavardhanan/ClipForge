# ClipForge Reframe Feature — Implementation Plan

> Subject-tracking dynamic reframe so the speaker fills the 9:16 frame (fixes "tiny figure in a wide shot"). Builds on Slice 1. Node/JS face detection (no Python).

**Goal:** Replace the static center-crop with a smoothed, subject-tracked pan/zoom so the dominant speaker is centered and fills the vertical frame.

**Architecture:** Detect faces on sampled frames (Node face detector) → build a smoothed crop-track `{time, cx, cy, scale}[]` → for tracked clips, `extractRaw` keeps the FULL 16:9 segment and **Remotion applies the per-frame pan/zoom** (the track passed as props) on the `OffthreadVideo`, then captions on top. Falls back to center-crop when no faces are found.

**Tech Stack:** Node face detector (implementer picks one that installs cleanly on Node 24/arm64 — e.g. `@vladmandic/face-api` or `@tensorflow-models/face-detection` + `@tensorflow/tfjs-node`), ffmpeg frame sampling, Remotion transforms.

## Global Constraints
- ESM `.js` imports (root) / extensionless (remotion). No Python.
- Reframe target: dominant face centered horizontally, sized so the face is ~22–30% of frame height (fills the frame without cutting the head); clamp the crop window inside the source bounds; EMA-smooth (α≈0.15) to kill jitter; never let the crop exceed source dims.
- Backward compatible: if detection finds no faces for a clip, fall back to the existing center-crop path (Slice 1 behavior).
- Crop track sampled at ~3 fps; Remotion interpolates between samples for smooth motion.

---

### Task RT1: Face-track module (`src/extraction/faceTracker.ts`)
**Produces:**
- `smoothTrack(raw: {time:number; box:{x:number;y:number;w:number;h:number}|null}[], srcW, srcH, alpha?): CropKeyframe[]` — PURE: fills gaps (hold last/center), EMA-smooths center+scale, clamps the 9:16 crop window inside source. `CropKeyframe = {time:number; cx:number; cy:number; cropW:number; cropH:number}` (cropH = cropW*16/9, centered on cx,cy, clamped).
- `detectFaceTrack(videoPath, srcW, srcH, fps?): Promise<CropKeyframe[]>` — samples frames via ffmpeg (~3fps) to temp PNGs, runs the Node detector, picks the dominant (largest) face per frame, then `smoothTrack`. Returns `[]` if no faces anywhere (caller falls back to center-crop).

**Tests:** TDD `smoothTrack` (pure): gap-fill holds last box; EMA reduces jump between two distant boxes; crop window stays within `[0,srcW]×[0,srcH]`; empty input → `[]`. Detection itself: integration test gated on the detector being installed, run against a real frame extracted from the downloaded video (`workspace/downloads/H14bBuluwB8/video.mp4`) — assert ≥1 face found; skip if detector/asset absent.

Add the chosen detector to `package.json` deps. If neither candidate installs cleanly on Node 24/arm64, STOP and report (don't thrash).

### Task RT2: Remotion reframe transform (`remotion/src/reframe.ts` + `CaptionedClip.tsx`)
**Produces (pure, tested):** `reframeStyle(track: CropKeyframe[], timeSec: number, srcW, srcH): { scale:number; translateXpct:number; translateYpct:number }` — interpolates the track at `timeSec`, returns the transform that maps the crop window to fill 1080×1920. Empty track → identity-ish (cover-fit center).
- `CaptionedClip.tsx`: accept optional `cropTrack` prop; wrap `OffthreadVideo` in a div whose transform = `reframeStyle(cropTrack, frame/fps, srcW, srcH)`; when `cropTrack` is empty/undefined, keep current `objectFit:cover` center behavior.
**Tests:** TDD `reframeStyle`: a centered track → ~centered transform; an off-center track → translate toward it; scale ≥ 1; empty track → identity. (Run via root vitest, `remotion/src/**`.)

### Task RT3: Extraction + pipeline wiring
- `clipExtractor.ts`: add `extractFullFrame(video, start, end, outPath)` — same as `extractRaw` but **no crop filter** (keep source 16:9), CFR, crf14 (it's the reframe input). Keep `extractRaw` for the no-face fallback.
- `remotionRenderer.ts`: `render()` accepts optional `cropTrack` + `srcW`/`srcH`, passes them as props.
- `cli/commands/all.ts`: per clip — run `detectFaceTrack` on the clip region; if track non-empty → `extractFullFrame` + `render({..., cropTrack, srcW, srcH})`; else → existing `extractRaw` (pre-cropped) + `render` without track. (Probe the source `width`/`height` once for srcW/srcH.)
**Tests:** `extractFullFrame` arg-builder (no crop filter; has `-fps_mode cfr`); pipeline path is covered by the live re-run.

### Task RT4: Live re-validation
Re-run `all <gogginsURL> --top 1`; extract a frame; confirm the speaker is centered and fills the frame (vs the tiny-figure baseline). Probe still 1080×1920.

## Self-Review
Covers: subject tracking (RT1), smooth pan/zoom application (RT2), full-frame extract + wiring + fallback (RT3), validation (RT4). Fallback to center-crop preserves Slice-1 behavior when no face. New dep limited to the face detector.
