# v4 Slice D — Camera v2 (Lock-On / Hold-Then-Glide) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crop's continuous micro-drift (a zero-lag EMA that always follows the subject) with a virtual-camera model that HOLDS still while the subject stays in a comfort box and GLIDES decisively (bounded velocity + acceleration, no overshoot) only when they leave it — the "shot by a real operator" look, the biggest remaining visual-polish lever.

**Architecture:** A new pure `src/extraction/camera.ts` provides `lockOnPath` (deadband hold + rate/accel-limited critically-damped glide toward a target) and `smoothCameraAxis` (EMA denoise → lockOnPath). `smoothTrack` and `buildActiveSpeakerTrack` swap the `smoothSeriesBidirectional` calls on **cx/cy** for `smoothCameraAxis`; cropH keeps its existing zoom hysteresis (already a hold behavior). All motion bounds are fractions of the source extent, so behavior is resolution-independent. Property tests guarantee bounded motion, no overshoot, and subject-stays-in-frame before it renders.

**Tech Stack:** TypeScript (ESM, Node 24), vitest (property-style tests for motion bounds).

## Global Constraints

- Pure signal processing, no new deps. `camera.ts` functions take arrays + options, return arrays — no I/O.
- Motion bounds are fractions of the source extent (srcW for cx, srcH for cy) so they scale across resolutions; the face sample rate is fps=3 (planFraming), so bounds are per-sample at that rate.
- **The subject must never leave the crop** — the deadband (comfort box) is strictly smaller than the crop half-width, so holding never lets the subject drift out. Property-tested; the existing `clampCropWindow` still runs after (crop ⊆ source bounds).
- Never pan across a shot cut — Slice C/framing already segment per shot; Camera v2 operates within `smoothTrack`/`buildActiveSpeakerTrack`, which are already called per-segment by `forcedCropTrack`/scene-cut segmentation. No change to that boundary handling.
- Determinism preserved (pure, no randomness).
- Standing gates after every task: `npx vitest run` green, `npx tsc --noEmit` clean (root), `cd remotion && npx tsc --noEmit` clean, `cd ui && npx next build` clean.

---

### Task 1: Lock-on camera path (`src/extraction/camera.ts`)

**Files:**
- Create: `src/extraction/camera.ts`
- Test: `tests/extraction/camera.test.ts`

**Interfaces:**
- Consumes: `smoothSeriesBidirectional` from `./faceTracker.js` (the existing EMA, reused for the denoise pre-pass).
- Produces (Tasks 2, 3):

```ts
export interface LockOnOpts {
  deadband: number;    // hold while |target − held| ≤ this (source px)
  maxVel: number;      // max |Δposition| per sample (source px)
  maxAccel: number;    // max |Δvelocity| per sample (source px) — ramps moves in/out
}
/** PURE: hold-then-glide path over a per-sample target series. Holds the current position
 *  while the target stays within `deadband`; once it leaves, accelerates (≤ maxAccel) toward
 *  the target, cruises (≤ maxVel), and decelerates to stop AT the target without overshoot
 *  (critically-damped: brake distance vⁿ derived so it never passes the target). */
export function lockOnPath(target: number[], opts: LockOnOpts): number[];
/** PURE: denoise the raw desired series (zero-lag EMA) then apply lock-on. Bounds are given
 *  as fractions of `extent` (srcW for cx, srcH for cy). */
export function smoothCameraAxis(desired: number[], extent: number, alpha?: number): number[];
export const CAMERA_DEADBAND_FRAC: number;   // 0.055 — comfort box half-size
export const CAMERA_MAX_VEL_FRAC: number;     // 0.11  — px/sample at fps=3 (~1/3 frame width per second)
export const CAMERA_MAX_ACCEL_FRAC: number;   // 0.045 — ramp
```

`lockOnPath` state machine per sample i (held position `p`, velocity `v`, both start at target[0], v=0):
- `err = target[i] − p`.
- If `|err| ≤ deadband` and `|v| < ε`: hold (`v=0`, output `p`).
- Else: desired direction `sign(err)`; compute stopping distance `stop = v²/(2·maxAccel)`; if `|err| ≤ stop` decelerate (`v -= sign(v)·maxAccel`), else accelerate (`v += sign(err)·maxAccel`) clamped to `±maxVel`; `p += v`; if we would pass the target (`sign(target[i]−p) !== sign(err)`) snap `p=target[i]`, `v=0`. Output `p`.

- [ ] **Step 1: Write failing tests** — (a) a constant target → output constant (held), zero motion; (b) a target that jitters ±(deadband/2) around a center → output stays flat (jitter rejected); (c) a step target (0 for 10 samples, then 100) with maxVel 10 → output holds at 0, then rises monotonically to 100 without exceeding 100 (no overshoot), and every `|out[i]−out[i-1]| ≤ maxVel + 1e-9`; (d) acceleration bound: `|(out[i]−out[i-1]) − (out[i-1]−out[i-2])| ≤ maxAccel + 1e-9`; (e) converges: after enough samples output equals the target; (f) `smoothCameraAxis` deterministic (same input twice equal).
- [ ] **Step 2:** Run `npx vitest run tests/extraction/camera.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(extraction): lock-on camera path — deadband hold + bounded eased glide`

### Task 2: Use Camera v2 in `smoothTrack`

**Files:**
- Modify: `src/extraction/faceTracker.ts` (`smoothTrack` cx/cy path)
- Test: `tests/extraction/faceTracker.test.ts` (extend + reconcile existing smoothing assertions)

**Interfaces:**
- Consumes: `smoothCameraAxis` (Task 1).

- [ ] **Step 1:** In `smoothTrack`, replace `const smoothedCx = smoothSeriesBidirectional(desired.map((d) => d.cx), alpha);` and the cy line with `const smoothedCx = smoothCameraAxis(desired.map((d) => d.cx), srcW);` / `smoothCameraAxis(..., srcH)`. Leave `smoothedCropH` (zoom hysteresis) unchanged.
- [ ] **Step 2:** Add a `smoothTrack` test: a face that holds still for 1s then jumps → the crop cx holds flat during the still period (successive cx equal within 1px) and never overshoots the new face center. Run — some existing "smoother than causal EMA" assertions may tighten/loosen; reconcile them to the hold-then-glide character (a held segment is *flatter* than EMA, so "smoother" assertions still hold; if one asserted continuous tracking, update it to expect a hold).
- [ ] **Step 3:** `npx vitest run tests/extraction/faceTracker.test.ts` — PASS (update reconciled assertions as needed).
- [ ] **Step 4: Commit** `feat(extraction): smoothTrack uses the lock-on camera (single-subject)`

### Task 3: Use Camera v2 in `buildActiveSpeakerTrack`

**Files:**
- Modify: `src/extraction/faceTracker.ts` (`buildActiveSpeakerTrack` cx/cy path)
- Test: `tests/extraction/faceTracker.test.ts` (extend)

**Interfaces:** Consumes `smoothCameraAxis` (Task 1). The speaker-switch easing (§ existing `eased` ramp) stays: it shapes the `desired` target; lock-on then glides to follow that ramp within motion bounds.

- [ ] **Step 1:** Replace the `smoothedCx`/`smoothedCy` `smoothSeriesBidirectional` calls in `buildActiveSpeakerTrack` with `smoothCameraAxis(eased.map((d) => d.cx), srcW)` / `(..., srcH)`.
- [ ] **Step 2:** Extend the active-speaker test: two speakers, active one holds then switches → the crop holds on speaker A, then glides (bounded velocity, no overshoot) to speaker B; every crop window stays inside source bounds (existing clamp). Run — PASS.
- [ ] **Step 3:** `npx vitest run tests/extraction/faceTracker.test.ts tests/extraction/activeSpeaker.test.ts` — PASS.
- [ ] **Step 4: Commit** `feat(extraction): active-speaker track uses the lock-on camera (multi-subject)`

### Task 4: Subject-in-frame property + live smoke + docs

**Files:**
- Test: `tests/extraction/camera.test.ts` (subject-containment property)
- Modify: `docs/superpowers/specs/2026-07-06-v4-sixpart-gap-analysis.md`, memory

- [ ] **Step 1:** Property test in camera.test.ts: for a random-walk target bounded within `[cropHalf, extent−cropHalf]`, with `deadband < cropHalf`, assert the lock-on output stays within `deadband` of... no — assert the TARGET stays within `maxHold` of the output at all times where `maxHold = deadband + maxVel` (the camera never lets the subject get more than one deadband + one step ahead), so with `cropHalf > deadband + maxVel` the subject is always inside the crop. Encode `CAMERA_DEADBAND_FRAC + CAMERA_MAX_VEL_FRAC < 0.5·(min crop half-width fraction)` as a documented invariant and test the numeric relation holds for the constants.
- [ ] **Step 2:** `npm run build`; run on a cached single-speaker source (`node dist/cli/index.js all "<cached talky>" --top 1 --allow-repeats --min-retention 0 --framing crop`). Inspect the exported clip's cropTrack (from the render logs / a quick node dump of `planFraming`): confirm the cx series has flat HOLD stretches (not continuous drift) and bounded steps at moves. **Play the clip**: the camera should feel locked then glide, not seasick. Compare with `git stash` of Camera v2 off if unsure.
- [ ] **Step 3:** Update the gap analysis (tick #24 camera v2, #29 time-based switch hysteresis if the deadband subsumes it — note #26 caption-zone avoidance + #27 look-room still deferred) and memory; commit.

## Self-review

- **Spec coverage (Slice D deltas):** #24 lock-on hold/move with bounded velocity/accel + anti-overshoot → T1/T2/T3; the deadband comfort box subsumes #29 (time-based subject-switch hysteresis) for micro-jitter — the existing jump-distance switch easing in buildActiveSpeakerTrack handles genuine speaker changes. Deferred (documented): #26 caption-zone avoidance (needs the shared safe-area rect wired into the crop solver — a follow-up), #27 look-room from gaze (low value).
- **Risk control:** the desync/seasick risk is caught by the property tests (bounded velocity/accel, no overshoot, subject-in-frame invariant) BEFORE render, plus the mandatory play-and-watch smoke; `clampCropWindow` still guarantees crop ⊆ source. Cropr cutting across shots is unaffected (per-segment call sites unchanged).
- **Type consistency:** `LockOnOpts`/`lockOnPath`/`smoothCameraAxis` T1 → T2/T3; constants `CAMERA_*_FRAC` T1 used in T4's invariant test.
- **Reconciliation risk:** existing faceTracker smoothing tests assert EMA character; T2/T3 explicitly reconcile them to hold-then-glide (a hold is strictly flatter, so "smoothness" assertions survive; only a "tracks continuously" assertion, if any, flips to "holds then moves").
- **Placeholder scan:** every step has real signatures/state-machine math/assertions; no TBD.
