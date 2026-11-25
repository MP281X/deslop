# Coding standards

- Each policy lives once, in the first tool that covers it: the compiler and Effect rules, then native lint rules, then a custom rule only for coverage or safe fixes they lack. Competing compiler rewrites stay off.
- A custom rule accepts the intended forms; its accepted examples and fixes pass the whole preset, and repeated fixes reach a fixed point. Prove a replacement with the old rule's failing cases.
- Test only custom rules. Upgrades opt into no new rules, and declined rules stay out.
- Lint checks stay syntax-only, since Oxlint's JS plugin API exposes no TypeScript program; codebase-wide judgement is review's. Typecheck through the shared `check`, never per-package scripts.
- Checks ship in the preset, so consuming codebases get them too.
