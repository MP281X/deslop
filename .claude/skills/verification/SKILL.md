---
name: verification
description: Load before editing code for a bug or a failed check, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Lint owns what a parser can check; this covers running behaviour. The repository's `AGENTS.md` names its fixer, checks and tests.

## Diagnose

```mermaid
stateDiagram-v2
    [*] --> Reproducing : a bug or check fails
    Reproducing --> Fixing : failing check, request or capture on base, before any theory
    Fixing --> Probing : edit where the wrong state starts, not a guard, retry or swallowed error
    Probing --> [*] : probe [passes]
    Probing --> Fixing : probe [fails after the first edit]
    Probing --> Reproducing : probe [fails after the second edit] / drop the hypothesis
```

## Validate

The main thread validates itself, with no delegate and no fixer, which already ran on dev.

```mermaid
stateDiagram-v2
    [*] --> Probing : a commit to validate
    Probing --> Running : ssh -o ConnectTimeout=3 mp281x@desktop true [succeeds] / the command below in the background, then t3_background_wait
    Probing --> Running : probe [fails] / the checks and tests in the dev worktree, in the foreground
    Running --> [*] : exit / read the exit code and failing lines
```

```bash
ssh mp281x@desktop 'cd ~/<repo> && w=/tmp/validate/<repo>-<dev worktree name> && git fetch -q ssh://mp281x@dev<dev worktree path> <sha> && { git -C $w checkout -q --detach <sha> 2>/dev/null || git worktree add -q --detach $w <sha>; } && cd $w && vp install && <checks> && <tests>'
```

Each thread reuses its own validation worktree, so dependencies and the `vp` cache stay warm and threads need no locks; nothing is pushed and no branch is created. [Maintenance](../environment/references/maintenance.md#clean) removes it.

## Prove

- **Surface.** UI, and backend changes a screen shows, in the T3 browser; native changes in the Device panel. This standing request covers the preview tools.
- **Capture** representative data once a condition holds, on the head, with its short commit in the caption; a rebase retakes them all.
- **Fixed means flipped.** The probe that failed on base passes on the head.
- **States.** Cold open, deep-link reload and a failed first request; `iphone-12-pro` and 1440×900, plus the widest target reached; dark and light when colour changed; web and iOS side by side when both exist.
- **Read each capture** for duplicates, clipping, overflow and untruthful loading, empty or error states, and audit web states with `preview_evaluate` and [references/page-audit.js](references/page-audit.js).
- **Unproved** claims say `unverified: <what was not run>`.

## Review

Never for decided work, which a review only re-argues.

```mermaid
stateDiagram-v2
    [*] --> Reviewing : consequential question open / one read-only reviewer in a fresh context
    Reviewing --> [*] : review [no findings]
    Reviewing --> Fixing : review [findings, first round]
    Fixing --> Reviewing : fixed / second round
    Reviewing --> Replanning : review [findings, second round] / the approach is wrong
    Replanning --> [*]
```

- **Input.** The decisions, the user's acceptance criteria, the head and the captures; the reviewer opens its own preview, since source is not evidence.
- **Scope.** Architecture, UI/UX and function, not lint's domain.
- **Finding.** The input, the result, `path:line` and a severity: P1 broken contract, data loss, secret exposure or false claim; P2 architecture or ownership violation; P3 reads worse than the recorded design.

## Tests

Keep a reproducing probe only under the repository's test choices, at the narrowest public seam.
