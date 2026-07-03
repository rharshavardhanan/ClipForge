# Channel Intelligence v1 — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm session; amended same day after design review — hook arms, template confidence, EMA decay, failure memory)

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

This IS the stop-rate proxy: the Analytics API exposes no impressions/CTR for
Shorts-feed traffic, so `engagedViews / views` (its complement) is the best
available signal for "did the opener stop the swipe".

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

## 2. Director learning (`src/avss/policy.ts`, `all.ts`, merger, seo)

Five Director bandit dimensions under the same epsilon-greedy machinery:

| Arm group | Values | Applied at generation time as |
|---|---|---|
| `clipLenBucket` | `short` \| `mid` \| `long` | merger target length: short → target 22s / max 25s; mid → target 32s / max 40s; long → target 48s / max 58s — always clamped into the active mode's min/max envelope (clippies 15–45, mindcuts 20–60), and the existing sentence-aware clamp always wins — never cut mid-sentence. |
| `hookWordBucket` | `punchy` \| `full` | `truncateHook` word limit: punchy → ≤5 words; full → current ≤8 behavior. |
| `openerIntensity` | `hot` \| `cold` | ranker sort-only boost (same pattern as v6 mode priorities — composite score untouched) for candidates whose opener matches the chosen bucket. RMS is already available at selection time. Bucket rule (scale-free): hot ⇔ mean RMS over the clip's first 2s ≥ 1.1 × mean RMS over the whole clip. |
| `hookVisualType` | `face` \| `other` | ranker sort-only boost, checked only for the **top 6 ranked candidates** (one frame at window start + 0.5s each, existing face detector `detectFrameObs` — no new ML, bounded cost). B-roll never opens a clip (planner keeps the hook 3s clear), so two values suffice. |
| `titlePattern` | `question` \| `number` \| `negation` \| `statement` | SEO title choice (§2.1). |

- `ModeArms` gains the five groups; `Policy.version` bumps to 2; `loadPolicy`
  fills missing groups with `{}` so an existing `policy.json` keeps working.
- `chooseExploit` / explore covers the new dimensions identically to existing ones.
- **Credit rule (the honesty core):** all five Director arms are updated with
  `hookHold` (§1.3), *not* the overall reward — the swipe-or-stay decision is
  what moment, opener, hook, and title choices actually control. No retention
  curve → no Director update that cycle (Editor arms still update from the
  overall reward as today).
- Adding dimensions does not multiply sample needs: every upload credits every
  dimension independently (per-dimension bandits). Confounding between
  dimensions is accepted, as it already is for the Editor arms.

### 2.1 Title-pattern selection (`src/export/seo.ts`)

Pure classifier `classifyTitle(s: string)` → `question` (starts with an
interrogative or ends `?`), `number` (contains a digit), `negation`
(`never | stop | don't | worst | no one | nobody`), else `statement`.
Precedence when multiple match: question > negation > number > statement.

`baseTitle` gains an optional `patternHint`: pick the first `clip_titles`
candidate whose classification matches the hint; no match → current behavior
(`clip_titles[0]`). `all.ts` passes the policy-chosen pattern as the hint.

### 2.2 EditDna additions

```ts
EditDna {
  // existing fields unchanged, plus:
  durationSec: number;
  hookWords: number;
  openerHot: boolean;                     // §2 bucket rule, precomputed
  hookVisualType: 'face' | 'other';
  titlePattern: 'question' | 'number' | 'negation' | 'statement';
}
```

`titlePattern` records the classification of the title **actually used** (the
SEO pack's final title, classified post-hoc) — so credit follows reality even
when the hint found no matching candidate. `extractDna` gains an optional
`{ title?: string }` meta argument. Old `clip.json` avss blocks lack the new
fields → those Director dims simply aren't credited for those clips.

## 3. Template evolution v2 (`src/avss/templates.ts`, `stats.ts`)

### 3.1 Confidence score

`EliteTemplate` gains `confidence: number` and `views: number` at promotion time:

```
sampleFactor = views / (views + 100)
consistency  = clamp01(1 − 2·stddev(retention across the video's snapshots))
               // 0.8 by definition until the video has ≥2 snapshots
confidence   = retention × sampleFactor × consistency
```

**Promotion rule:** retention ≥ 70% (unchanged) **AND views ≥ 100**. An 80%
retention on 40 views is noise, not DNA. `dnaSimilar` dedupe unchanged, except:
a new candidate that dedupes against an existing template **replaces** it when
its confidence is higher (same version number, file overwritten).

### 3.2 Selection with age decay

At generation time templates are ranked by

```
effectiveConfidence = confidence × 2^(−ageDays / 45)      // 45-day half-life
```

and the highest wins (today: latest version wins). Stored files are never
mutated by decay — it applies at selection only. Legacy templates without
`confidence` get `retention × 0.5` on load (unknown sample size → shrunk).

### 3.3 Non-stationary policy: EMA instead of incremental mean

`bump()` in `policy.ts` switches from the 1/n incremental mean to a constant
step-size EMA: first pull sets `mean = reward`; afterwards
`mean ← mean + 0.3·(reward − mean)`. `n` is still tracked (bestArm's `n ≥ 1`
gate, diagnostics). Recent performance dominates automatically; an arm that
stops winning fades without any timestamp math. (A `reward · e^(−λt)` decay at
update time was considered and rejected: snapshots are re-taken over a video's
life, so the newest measurement of an older video would get the *most* decayed
reward — backwards.)

### 3.4 Failure memory (`negative_templates/`)

Mirror of the elite machinery, per channel:

- **Demotion rule** (checked on every FULL snapshot, views ≥ 100):
  `skipRatio ≥ 0.75` **or** `retention < 35%` → save the clip's DNA as
  `negative_template_vN.json` under the channel's `negative_templates/`
  (global `./negative_templates/` when channel-less; `dnaSimilar` dedupe).
- **Avoidance rule** (generation time): after a variant's DNA is determined,
  if it is `dnaSimilar` to any negative template **and** the variant came from
  an explore roll, re-roll the explored dimensions once (seeded rng, so still
  deterministic); if still similar, proceed and log. Elite-exploit variants are
  never blocked — proven DNA outranks an old failure.

The bandit's low arm means already avoid *individual* bad values (presets, zoom
densities, lengths); negative templates add what the bandit cannot see —
avoidance of bad **combinations**.

## 4. Multi-channel manager (per-channel learning state)

### 4.1 Layout

```
workspace/channels/<channel>/
  channel.json          { name, mode: 'clippies' | 'mindcuts', created_at }
  policy.json
  performance/<videoId>.json
  elite_templates/elite_template_vN.json
  negative_templates/negative_template_vN.json
```

`<channel>` is the sanitized channel name (lowercased, non-alphanumerics → `-`).

### 4.2 Resolution rule

New helper `channelPaths(channel: string | undefined, wsDir?: string)` returns
`{ policyPath, perfDir, templatesDir, negativeDir }`:

- channel given → the per-channel paths above
  (`ELITE_TEMPLATES_DIR` env still overrides `templatesDir`, as today).
- no channel → the existing global paths, byte-for-byte
  (`workspace/policy/policy.json`, `workspace/performance/`,
  `./elite_templates/`, `./negative_templates/`). **No migration of existing
  global data.**

### 4.3 Command behavior

- `all --channel X`: if `channel.json` exists, its `mode` is the default (an
  explicit `--mode` flag overrides for the run but does not rewrite
  `channel.json`); if it doesn't exist, the run's mode (flag or default)
  creates it. Policy load/save and template lookup (elite + negative) go
  through `channelPaths(X)`.
- `upload --channel X`: the `youtube` record written into `clip.json` gains
  `channel: X` (absent when uploaded without the flag).
- `stats`: learning-state routing per target = `clip.json`'s recorded
  `youtube.channel`, else the run's `--channel` flag, else global. The
  `--channel` flag keeps its existing meaning for OAuth token selection; a
  mixed-channel stats run therefore only credits targets whose recorded channel
  matches the token's channel — others are reported in the table but marked
  `partial` (wrong-channel analytics calls would 403 anyway).
- Policies/templates are read and written per channel; two channels never share
  arm counts, elite templates, or negative templates.

RankRot is a separate engine with no editing policy — unchanged, out of scope.

## 5. Error handling, migration, tests

- **Degradation ladder:** metric 400 → v1 metric set; no curve → skip Director
  credit only; no analytics → `partial`, no policy updates at all; per-video
  failure → row error, run continues (existing rule).
- **Migration:** policy v1 → v2 on load (fill missing arm groups); all new
  snapshot/DNA/template fields optional with defined legacy defaults
  (templates: `confidence = retention × 0.5`); global-path behavior when
  `--channel` absent is bit-identical to today.
- **Tests** (vitest, existing `fetchFn` / `getToken` seams):
  - reward v2 with/without skip data; v1 fallback exactness
  - `computeSkipRatio` edge cases (0 views, missing engagedViews, clamping)
  - retention-curve parsing (name-based columns, empty rows, 400, no-scope)
  - `hookHold` nearest-bucket selection and clamping
  - bucket derivation from `EditDna` (boundaries: 25s/40s, 5 words, 1.1× RMS)
  - `classifyTitle` precedence and each pattern; `baseTitle` hint match + fallback
  - policy v1→v2 load migration; Director arms credited with hookHold while
    Editor arms take reward on the same stats pass; EMA update math (first
    pull, subsequent pulls, fade of a stale winner)
  - confidence formula (sampleFactor, consistency default, stddev path),
    promotion views floor, higher-confidence replacement on dedupe
  - `effectiveConfidence` age decay and selection ordering; legacy-template
    confidence default
  - negative-template demotion rule (both triggers, views floor), explore
    re-roll on `dnaSimilar`, elite-exploit never blocked
  - `channelPaths` resolution (channel vs global, env override, sanitization)
  - stats channel routing (recorded channel beats flag beats global)
  - upload writes `channel` into the `youtube` record
