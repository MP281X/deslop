# Coding standards

- Each policy lives once, in the best tool: the compiler and Effect rules first, then native lint rules, then a custom rule only when it adds coverage or safe fixes they lack.
- A custom rule accepts the intended forms. Its accepted examples and fixes pass the whole preset, and repeated fixes reach a fixed point. Prove a replacement with the old rule's failing cases.
- Only custom rules have tests. Upgrades never opt into new rules, and declined rules stay out.
- Lint checks are syntax-only; codebase-wide judgement belongs to review. No per-package typecheck scripts.
- Checks ship in the preset, so consuming codebases get them too.
