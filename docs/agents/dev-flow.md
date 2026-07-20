# The dev-flow relay

The recommended path that carries a feature from idea to merged PR. Each step
hands the baton; the human decides when to pass it. This is a reference for how
the skills chain — not a skill itself. Invoke each step's skill directly
(`/grill-with-docs`, `/to-spec`, …).

## Pipeline

```
wayfinder (fog) ─┐
                 ├─→ grill-with-docs → to-spec → to-tickets → implement → code-review
   quick start ──┘
```

- **wayfinder** entry: multi-session fog — the way to the destination isn't visible yet.
- **quick start** entry: single-session sharpening — you know roughly what you want.
- **skip** any step to pass the baton immediately.
- `implement` ends with `code-review` internally.

## Model per step

| Step                        | Model  | Why                                  |
| --------------------------- | ------ | ------------------------------------ |
| wayfinder / grill-with-docs | Opus   | reasoning-heavy — decisions and ADRs |
| to-spec                     | Sonnet | synthesis                            |
| to-tickets                  | Sonnet | mechanical breakdown                 |
| implement                   | Sonnet | code generation                      |
| code-review                 | Opus   | judgement-heavy — two-axis review    |

Two transitions only: Opus→Sonnet after `grill-with-docs`, Sonnet→Opus after
`implement`. Switch with `/model`.

## Compaction checkpoints

The two model transitions are the natural compact points — you choose what
survives into the next step:

- `grill-with-docs` → `to-spec`: `/compact focus on design decisions and domain terms`
- `implement` → `code-review`: `/compact focus on the implementation and PR`

Compact only when the session feels heavy; don't compact mid-phase. `/statusline`
shows live context usage. Keep grill → spec → tickets in **one** unbroken window;
each `/implement` then starts fresh from its ticket.
