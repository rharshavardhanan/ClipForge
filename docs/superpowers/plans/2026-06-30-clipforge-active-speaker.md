# ClipForge Multi-Subject / Active-Speaker Reframe

> Track multiple faces, pick the person talking (landmark mouth-movement), cut the crop between speakers smoothly. Plus zero-lag (non-causal) smoothing + shot hysteresis applied to both single- and multi-subject paths. Uses the existing @vladmandic/face-api (multi-face + 68 landmarks). Single-face/​no-face → existing behavior (fallback).

## MS1 — detection + active-speaker selection (`src/extraction/activeSpeaker.ts` + faceTracker changes)
- Detect ALL faces + landmarks per sampled frame: `detectAllFaces(img, opts).withFaceLandmarks()`.
- Per face/frame: `{ box, mouthOpenness }` where mouthOpenness = (inner-lip vertical gap)/(mouth width) from mouth landmarks (48–67).
- **Track association (PURE `associateTracks`)**: greedy match faces to prior-frame tracks by center-distance/IoU; assign stable track ids; new track when unmatched.
- **Active-speaker (PURE `pickActiveSpeaker`)**: per sample time, among present tracks choose the one with the highest mouth-movement (std of mouthOpenness over a ±~0.75s window). **Switch hysteresis**: keep current speaker unless a challenger is clearly more active for a min dwell (~0.5s) — no flip-flop. Output a per-sample series `{ time, box }` (the active speaker's box; gap-fill holds last).
- Tests: TDD `mouthOpenness` from synthetic landmarks; `associateTracks` (two faces across frames keep ids; a new face gets a new id); `pickActiveSpeaker` (the moving-mouth track wins; hysteresis prevents a 1-frame flip). Detection integration gated (skip if model/asset absent).

## MS2 — crop-track build + zero-lag smoothing + hysteresis + integration
- Build crop window from the active-box series via the existing geometry (face 34%, upper-third 38%, 9:16, 0.9 cap, inside-source clamp).
- **Speaker-switch transition:** when the active box jumps (speaker change), interpolate crop center+size over ~0.5s (ease) instead of snapping.
- **Zero-lag smoothing (PURE):** replace causal EMA with non-causal **forward-backward EMA** (smooth left→right then right→left) — offline, so no lag. Apply to cx/cy/cropH.
- **Shot hysteresis (PURE):** deadband on cropH — only change zoom when |Δ| exceeds a threshold (e.g. 6% of current), else hold — kills "breathing."
- Wire so `detectFaceTrack` uses multi-face active-speaker when ≥2 tracks exist; single track → current single-subject path (now also benefiting from zero-lag smoothing + hysteresis); no faces → [] (center-crop fallback). Pipeline unchanged downstream (still returns `CropKeyframe[]`).
- Tests: forward-backward smoothing reduces lag vs causal on a ramp (the smoothed value at a step is centered, not trailing); hysteresis holds cropH within the deadband; switch transition interpolates (mid-transition center between the two speakers).

## Notes
- Validate via a live run on a 2-speaker clip later (the Grit talk is single-speaker → exercises the single-track path + smoothing/hysteresis; multi-speaker needs a podcast URL).
- Compute cost: landmarks add to WASM detection time; keep sampling ~2–3 fps.
