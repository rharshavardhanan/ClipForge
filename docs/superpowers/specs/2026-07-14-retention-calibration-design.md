# Retention Calibration & Duration-Aware Floor — Design

**Date:** 2026-07-14 · **Status:** Approved (user, same day) · **Driver:** predicted retention never exceeds ~54% while the flat floor sits at 70% — every clip lands in `below_retention/`. Root cause analysis (this session): the AVSS hazard model's realistic output band is ~35–60% *by construction* (per-tick survival math), the floor was never calibrated against real data, and zero real analytics snapshots have ever been ingested (the pre-2026-07-13 token lacked the analytics scope; the new Extent_Clipz token has it).

## 0. Decisions

1. Calibration is a layer **outside the simulator** — raw simulator scores keep driving variant A/B/C comparison and the policy bandit unchanged; only reporting and the floor decision use the calibrated scale.
2. Cold-start prior so tiering is sensible from day one; least-squares refit once real pairs exist.
3. Floor becomes duration-aware on the calibrated (real-world) scale; explicit `--min-retention` stays as a flat manual override.
4. Upload category follows the clip's mode; `--category` overrides.

## 1. Calibration layer — `src/avss/calibration.ts` (pure) 

```ts
export interface RetentionCalibration {
  slope: number;          // b in real ≈ a + b·predicted
  intercept: number;      // a
  n: number;              // pairs behind the fit; 0 = cold-start prior
  updatedAt: string;      // ISO
}
export const PRIOR_CALIBRATION: RetentionCalibration =
  { slope: 0.75, intercept: 0.30, n: 0, updatedAt: '' };
export const MIN_PAIRS_TO_FIT = 5;
export const SLOPE_CLAMP: [number, number] = [0.2, 2.0];
export const INTERCEPT_CLAMP: [number, number] = [0, 0.6];
export const CALIBRATED_MAX = 0.95;

applyCalibration(predicted: number, c: RetentionCalibration): number
  // clamp01(predicted) → a + b·x → clamp [0, CALIBRATED_MAX]
fitCalibration(pairs: { predicted: number; real: number }[]): RetentionCalibration
  // < MIN_PAIRS_TO_FIT → PRIOR_CALIBRATION (n = pairs.length preserved for logging)
  // else least-squares affine; slope/intercept clamped; degenerate variance (all
  // predicted equal) → PRIOR with n recorded
collectCalibrationPairs(exportsRoot: string, performanceDir: string): Promise<Pair[]>
  // walk workspace/exports/*/ (and below_retention/) clip.json files that have BOTH
  // youtube.videoId AND avss.predicted.retention; join to workspace/performance/<videoId>.json
  // (latest history entry with analytics), real = avgViewPct/100 clamped [0, 1.5] (Shorts loop >100%)
loadCalibration(path?) / saveCalibration(c, path?)
  // workspace/policy/retention_calibration.json; load fail-soft → PRIOR_CALIBRATION
```

Storage: `workspace/policy/retention_calibration.json` (same dir as policy.json).

## 2. `clipforge stats` refits after ingest

After snapshots are written (existing flow untouched): `collectCalibrationPairs` → `fitCalibration` → `saveCalibration`, log `calibration: <n> pairs, real ≈ <a> + <b>·predicted` (or `calibration: <n> pairs — cold-start prior stands` when n < 5). Any error in this step warns and never fails the stats run.

## 3. Duration-aware floor — `retentionFloor(durationSec)` in calibration.ts

Piecewise-linear on the calibrated scale:

| duration | floor |
|---|---|
| ≤ 20s | 0.80 |
| 20–30s | linear 0.80 → 0.70 |
| 30–60s | linear 0.70 → 0.55 |
| ≥ 60s | 0.55 |

`all.ts` changes at the floor check: `calibrated = applyCalibration(winner.sim.avgRetention, cal)`; floor = explicit `--min-retention` value (flat, calibrated scale; `0` still disables tiering) when the flag was passed, else `retentionFloor(clipDurationSec)`. CLI default for `--min-retention` changes from `70` to **unset** (auto curve); help text updated. The calibration is loaded once per run (fail-soft → prior).

**Reporting:** manifest + GUI `predicted_retention` now carry the **calibrated** value (GUI badges/thresholds keep reading the same field); the raw simulator value is preserved in the clip.json `avss` block as `predicted.retention_raw` alongside the calibrated `predicted.retention`. The below-floor table prints both (`cal 67% (raw 49%) vs floor 62%`).

Sanity anchor (must hold in tests): predicted 0.49 at 57s → prior-calibrated ≈ 0.6675 vs floor(57s) ≈ 0.565 → **passes**; predicted 0.30 at 20s → 0.525 vs 0.80 → fails.

## 4. Upload category — `buildUploadBody`

`categoryId`: from the clip's mode (`clipJson.avss?.dna?.mode`): `clippies → '24'` (Entertainment), `mindcuts → '22'` (People & Blogs), unknown/absent → `'24'` (today's value). New CLI flag `upload --category <id>` overrides for the whole invocation; GUI publish route untouched (no new UI).

## 5. Degradation & compatibility

- No calibration file (every run today): prior applies — behavior changes deliberately (clips start passing the floor per the sanity anchor). Old exports keep their old clip.json values; only new runs are affected.
- `--min-retention 70` passed explicitly behaves as a flat 0.70 floor on the calibrated scale (stricter than the old raw-scale 70 in effect, but sane).
- AVSS variant selection, policy arms, elite-template promotion (real-retention based) are all untouched.
- Stats with no uploads/pairs: prior stands, one log line.

## 6. Testing

Pure: applyCalibration clamps; fitCalibration (exact fit on synthetic linear pairs, slope/intercept clamps, <5 pairs → prior, degenerate variance → prior); retentionFloor anchors + interpolation (20/25/30/45/60/90s); collectCalibrationPairs on fixture dirs (missing videoId skipped, latest snapshot wins, loop >100% clamp). Wiring: all.ts floor decision with explicit flag vs auto (both tiers), manifest carries calibrated + avss block carries raw (exporter test). Upload: category mapping + --category override (buildUploadBody unit). Live: rerun a cached video and confirm the 49%-raw clip lands top-level with calibrated ≈ 67%.

## 7. Out of scope

Recalibrating the simulator's internal hazard constants (the external map preserves variant-comparison semantics); per-channel calibration curves (single global file until data volume justifies more); GUI display of raw-vs-calibrated (badge keeps one number); SP3 editing levers (hooks/length/sound design) — separate project.
