# Channel Intelligence v1 — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm session)

## Goal

The Director and Editor learn from *every* real YouTube statistic — including the
view-to-skip ratio and the per-second retention curve — with learning state kept
separately per channel.

Today the Editor's bandit learns from 3 analytics metrics globally; the Director
learns nothing; all learning state (policy, elite templates, performance history)
is global. This slice closes those three gaps. Explicitly **out of scope**: the
orchestration daemon / upload scheduler (dropped — no always-on machine), reupload
actions, live title/thumbnail A/B, multi-platform trend hunting, dashboard UI
changes (the CLI stats table gains the new columns; UI display is a follow-up).

## 1. Metrics expansion (`src/avss/performance.ts`)

### 1.1 Expanded analytics query

`fetchAnalytics` requests, per video:

```
views, engagedViews, averageViewPercentage, averageViewDuration,
estimatedMinutesWatched, likes, dislikes, comments, shares, subscribersGained
```

`AnalyticsStats` grows matching optional fields (existing fields stay required
so old snapshots/tests remain valid):

```ts
interface AnalyticsStats {
  avgViewPct: number;
  avgViewDurationSec: number;
  shares: number;
  views?: number;              // analytics-side views (Shorts: every play)
  engagedViews?: number;       // Shorts "viewed" (not swiped away)
  estimatedMinutesWatched?: number;
  likes?: number; dislikes?: number; comments?: number;
  subscribersGained?: number;
}
```

**Metric fallback chain:** if the reports call returns HTTP 400 (a metric not
supported for this channel/video), retry once with the v1 metric set
(`averageViewPercentage,averageViewDuration,shares`). 401/403 still means
`'no-scope'`; no rows still means `undefined`. Column lookup stays name-based
via `columnHeaders`.

### 1.2 Skip ratio

```
skipRatio = clamp01(1 − engagedViews / views)
```

Computed only when both `engagedViews` and analytics-side `views` are present and
`views > 0`; otherwise `undefined`. Exposed as a pure helper
`computeSkipRatio(a: AnalyticsStats): number | undefined`.

### 1.3 Retention curve

New `fetchRetentionCurve(videoId, token, fetchFn)` — second Analytics query:

```
dimensions=elapsedVideoTimeRatio
metrics=audienceWatchRatio,relativeRetentionPerformance
filters=video==<id>
```

Returns `RetentionPoint[]` (`{ ratio, watchRatio, relativePerf }`, ratio ∈ [0,1])
or `undefined` (no rows / 400 — young or too-few-views videos have no curve).
401/403 → `'no-scope'`. Stored on the snapshot as `retentionCurve?`.

Pure helper `hookHold(curve: RetentionPoint[]): number | undefined` — the
`watchRatio` of the point nearest `ratio = 0.10`, clamped to [0, 1]. This is the
Director's credit signal (§2). `undefined` when the curve is empty.

### 1.4 Reward v2

When `skipRatio` is available:

```
reward = clamp01(0.30·retention + 0.15·completion + 0.15·rewatch
       + 0.15·(1 − skipRatio) + 0.10·likesNorm + 0.10·commentsNorm + 0.05·sharesNorm)
```

When `skipRatio` is unavailable, use the v1 formula unchanged
(0.35/0.20/0.20/0.10/0.10/0.05) — deterministic, no renormalization math.
`RewardBreakdown` gains `stayRate?: number` and keeps `partial` semantics: no
analytics at all → `partial: true` → never feeds any policy.

### 1.5 Snapshot schema

`PerfSnapshot` gains `retentionCurve?: RetentionPoint[]` and
`channel?: string`. Append-only history format unchanged; old snapshots stay
readable (all new fields optional).

## 2. Director learning (`src/avss/policy.ts`, `all.ts`, merger)

Two new bandit dimensions under the same epsilon-greedy machinery:

| Arm group | Values | Applied at generation time as |
|---|---|---|
| `clipLenBucket` | `short` \| `mid` \| `long` | merger target length: short → target 22s / max 25s; mid → target 32s / max 40s; long → target 48s / max 58s. The existing sentence-aware clamp always wins — never cut mid-sentence. |
| `hookWordBucket` | `punchy` \| `full` | `truncateHook` word limit: punchy → ≤5 words; full → current ≤8 behavior. |

- `ModeArms` gains the two groups; `Policy.version` bumps to 2; `loadPolicy`
  fills missing groups with `{}` so an existing `policy.json` keeps working.
- `chooseExploit` / explore covers the new dimensions identically to existing ones.
- **Credit rule (the honesty core):** the two Director arms are updated with
  `hookHold` (§1.3), *not* the overall reward — early retention is what moment
  and hook choices actually control. No retention curve → no Director update
  that cycle (Editor arms still update from the overall reward as today).
- `EditDna` gains `durationSec: number` and `hookWords: number` so `stats` can
  reconstruct which Director arms a clip pulled
  (`dnaToChoice` derives the buckets). Old `clip.json` avss blocks lack the
  fields → Director dims simply aren't credited for those clips.

## 3. Multi-channel manager (per-channel learning state)

### 3.1 Layout

```
workspace/channels/<channel>/
  channel.json          { name, mode: 'clippies' | 'mindcuts', created_at }
  policy.json
  performance/<videoId>.json
  elite_templates/elite_template_vN.json
```

`<channel>` is the sanitized channel name (lowercased, non-alphanumerics → `-`).

### 3.2 Resolution rule

New helper `channelPaths(channel: string | undefined, wsDir?: string)` returns
`{ policyPath, perfDir, templatesDir }`:

- channel given → the per-channel paths above
  (`ELITE_TEMPLATES_DIR` env still overrides `templatesDir`, as today).
- no channel → the existing global paths, byte-for-byte
  (`workspace/policy/policy.json`, `workspace/performance/`,
  `./elite_templates/`). **No migration of existing global data.**

### 3.3 Command behavior

- `all --channel X`: if `channel.json` exists, its `mode` is the default (an
  explicit `--mode` flag overrides for the run but does not rewrite
  `channel.json`); if it doesn't exist, the run's mode (flag or default)
  creates it. Policy load/save and elite-template lookup go through
  `channelPaths(X)`.
- `upload --channel X`: the `youtube` record written into `clip.json` gains
  `channel: X` (absent when uploaded without the flag).
- `stats`: learning-state routing per target = `clip.json`'s recorded
  `youtube.channel`, else the run's `--channel` flag, else global. The
  `--channel` flag keeps its existing meaning for OAuth token selection; a
  mixed-channel stats run therefore only credits targets whose recorded channel
  matches the token's channel — others are reported in the table but marked
  `partial` (wrong-channel analytics calls would 403 anyway).
- Policies/templates are read and written per channel; two channels never share
  arm counts or elite templates.

RankRot is a separate engine with no editing policy — unchanged, out of scope.

## 4. Error handling, migration, tests

- **Degradation ladder:** metric 400 → v1 metric set; no curve → skip Director
  credit only; no analytics → `partial`, no policy updates at all; per-video
  failure → row error, run continues (existing rule).
- **Migration:** policy v1 → v2 on load (fill missing arm groups); all new
  snapshot/DNA fields optional; global-path behavior when `--channel` absent is
  bit-identical to today.
- **Tests** (vitest, existing `fetchFn` / `getToken` seams):
  - reward v2 with/without skip data; v1 fallback exactness
  - `computeSkipRatio` edge cases (0 views, missing engagedViews, clamping)
  - retention-curve parsing (name-based columns, empty rows, 400, no-scope)
  - `hookHold` nearest-bucket selection and clamping
  - bucket derivation from `EditDna` (boundaries: 25s/40s, 5 words)
  - policy v1→v2 load migration; Director-arm updates use hookHold, Editor
    arms use reward, on the same stats pass
  - `channelPaths` resolution (channel vs global, env override, sanitization)
  - stats channel routing (recorded channel beats flag beats global)
  - upload writes `channel` into the `youtube` record
