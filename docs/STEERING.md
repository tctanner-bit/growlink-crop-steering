# Steering logic

Source of truth: `packages/core/src/engine.ts` (decisions), `profiles.ts` (Grodan targets), `tuning.ts` (parameters,
bounds, daily rules), `ai-review.ts` (Nova).

## Grodan targets (Large Blocks, One-Transplant System)

| Phase | Days | Day-level WC | Overnight DB | P2 DB | Substrate EC | Drain | Shots |
|---|---|---|---|---|---|---|---|
| 1 Propagation | 10–18 | — (tray weight: water at 40–50% loss) | — | — | 1.5–2.5 | — | monitored only |
| 2 Vegetative | 7–14 | 80%+ → 65% over first days | 10% | 2–3% | 2.5–4.5 | 0–10% | vegetative · small, frequent |
| 3 Flower setting | ~21 | 60–65% | 10–15% → ~25% by day 21 | 4–6% | 4–9 | 10–20% | generative · large, infrequent |
| 4 Swelling & bulking | ~21 | 60–65% | 10–15% | 2–3% | 4–7 | 20–30% | vegetative · small, frequent |
| 5 Ripening | 14–21 | 60–65% → 55–60% | 20–25% | 4–6% | 5–8 | 10–25% | generative · large, infrequent |

## One light cycle

A cycle runs from lights-on to the next lights-on.

1. **Night** — waiting for P1. Starts at `lights-on + startDelayHours`, or earlier if WC has dropped 1–2% since lights-on.
2. **P1 ramp** — `p1ShotPct` shots at least `p1IntervalMin` apart until WC reaches the day band's lower edge. Skipped if WC is already in band. Capped at 15 shots (alert).
3. **P2 maintain** — a shot fires when WC has fallen `p2TriggerPct` below the last post-shot peak (and `p2IntervalMin` has passed). Shot size refills toward the top of the band, up to `p2ShotPct`; with substrate EC above target the full dose runs (+25%) to drive refresh. A catch-up shot fires if WC drops well below the band.
4. **P3 dry-back** — no shots after `lights-off − stopBeforeLightsOffHours`.
5. **Close** — at the next morning's first regular shot the overnight dry-back is measured (last post-shot peak → WC at first shot), the cycle summary is stored, and the daily review runs.

Shot seconds = target WC rise ÷ (WC% per second from emitter flow and block volume × calibration). Calibration is an
EMA of observed ÷ planned rise for shots fired below the band; shortfalls near the band are booked as estimated drain.

## Daily review

Rules (always): ODB off target by more than a quarter of the band → move the last shot by
`(target − ODB) / daytime dry-back rate × 0.5`, max ±45 min. Peak WC low → bigger P1 shots, start 15 min earlier.
Peak WC high → smaller P2 shots. EC out of band (only when WC is in band) → refresh volume up/down. One move per parameter.

Nova (Claude, tool call `submit_review`): sees targets, phase guidance, the closed day, 7 days of history,
calibration, current tuning with bounds, and what the rules already did. Its changes are limited to
`MAX_STEP_PER_REVIEW` and clamped to `tuningBounds`. Suggest mode stores them for one-click apply.

## Validation

`npm run sim -- phase=N days=D` and `packages/core/test` run the engine against the block simulator with
30-second ticks. The phase 3 closed-loop test asserts peak WC within the band and ODB tracking the ramp after day 4.
