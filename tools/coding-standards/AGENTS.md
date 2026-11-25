# Coding standards

- Each policy lives once, in the best tool: the compiler and Effect rules first, then native lint rules, then a custom rule only when it adds coverage or safe fixes they lack.
- A custom rule accepts the intended forms. Its accepted examples and fixes pass the whole preset, and repeated fixes reach a fixed point. Prove a replacement with the old rule's failing cases.
- Test only custom rules. Upgrades opt into no new rules, and declined rules stay out.
- Keep lint checks syntax-only and leave codebase-wide judgement to review. Typecheck through the shared `check`, never per-package scripts.
- Ship checks in the preset so consuming codebases get them too.
