# SP3 spec inputs — captured 2026-07-07 (pre-spec notes, not a design)

**Status:** Input notes for the future SP3 spec (content-type classification + per-type
editing policies, per the 2026-07-06 hybrid-perception north-star). Recorded from a user
research paste analyzing DeagzzzShorts-style editing. SP3 gets its own brainstorm → spec
when reached; these must be on the table then.

## Context: what the paste argued (and why we agreed)

One generic editing engine fails on channels that switch styles per content type. Classify
the clip first, then apply a per-type editing policy. This **is** SP3 — the existing 2-mode
system (`src/modes.ts`, clippies/mindcuts) is the seed that grows into ~12 typed policies.
Most of the paste's "Directors" already map to approved specs (arc engine → SP2 Story
Graph, Camera Planner → SP4, MusicMap → montagem spec, elite templates → SP5).

## The five NEW ideas not covered by any existing spec

1. **Editorial caption interpretation** — captions as emotional interpretation, not
   transcription. Speech "Bro..." → caption `BRO...` then `NO WAY 💀`. Today captions are
   transcription-faithful with sentiment color (`src/captions/sentimentColor.ts`). This is
   an LLM pass that rewrites/augments caption text per content type. Natural home: a
   per-type policy field in SP3 (e.g. clippies-family types get it, podcast types don't).

2. **Sound design under dialogue** — risers/impacts/bass hits/whooshes mixed *under*
   speech at story beats (not just on zoom events, which is all `src/sfx/events.ts` does
   today). Needs: beat-typed SFX placement (tension → riser, punchline → impact), ducked
   mixing. Story-beat positions come from the arc engine / SP2 Story Graph.

3. **Motion-cadence audit rule** — "some motion every 1–2 seconds" as a concrete,
   auditable check in the existing quality auditor. Motion = zoom, crop change, caption
   event, overlay, cut, B-roll entry. Cheap to compute from the edit plan; flags static
   stretches. Per-type thresholds (podcast tolerates ~3s, clippies ~1.5s).

4. **Pacing-contrast curves** — deliberate rhythm contrast (fast → pause → fast → slow →
   explosion → silence), not uniform pacing. The editor has tighten/pace but no notion of
   contrast. Could be a per-type target "pacing envelope" the editor steers toward;
   emotional types get high contrast, informational types stay even.

5. **Context stitching / non-linear reordering** — jumping between cameras/moments,
   borrowing shots from elsewhere to strengthen narrative. Already known and deliberately
   deferred as "Narrative Fabrication" (Advanced Retention Layer system 4). Stance for
   SP3: **keep deferred**; riskiest item (can misrepresent events). Revisit only after
   SP2's Story Graph exists, and only as reaction/B-roll insertion, never event reordering.

## Constraint reminders that bit similar work before

- Speed ramps / freezes over speech desync audio — montagem solved this by muting native
  audio (music masters the timeline). Speech-preserving types cannot take velocity ramps;
  per-type policies must encode which time-manipulation FX are legal for that type.
- ffmpeg build lacks drawtext; all text/overlay rendering goes through Remotion.
- Free-only mandate: no paid APIs beyond the existing key-pool LLM usage.
