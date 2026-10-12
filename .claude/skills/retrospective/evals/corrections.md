# Corrections

Each class of correction the user repeats, with his words and the machine that now enforces it. A class without an enforcer gets one: a lint rule for code, a probe check in `score.py` for behavior. Prose is the last resort.

| Class                              | His words                                                                                                  | Enforced by                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Narrating comments                 | "there are too many comments in the code" (10-12)                                                          | Lint `no-multiline-comment`                                         |
| Wrappers and aliases               | "no useless wrappers or constructor functions" (09-16)                                                     | Lint `no-trivial-indirection`                                       |
| Impossible paths                   | "don't write code to handle impossible edge-cases" (10-05)                                                 | Engineering Happy path and Trusted data; cleanup audit              |
| Special handlers and compatibility | "i don't want to have special handlers" (10-12)                                                            | Engineering No compatibility; cleanup audit                         |
| Unrequested features               | "I prefer the agent doing less than I asked than doing more" (09-22)                                       | Cleanup audit against his words; final whole-branch audit           |
| Manual work a dependency does      | "never add models manually" (10-12)                                                                        | Review Beyond the diff: check the dependency's latest version first |
| Bloated output                     | "even tough it's visual it's still extremely bloated", "I still think that the output is terrible" (10-12) | Probe `ready`: reply under 40 words, overview under 150 words       |
| Status noise in replies            | "the informations on that the pipeline succeded ... are kinda useless" (10-12)                             | Probe `ready`: no check results, overview under 150 words           |
| Avoidable questions                | "I shouldn't be your scheduler" (10-12)                                                                    | Pair prompt Autonomy and Questions                                  |
| Missing proof                      | "i don't see any video proof" (10-12)                                                                      | Captures rules; body reader                                         |
| Reported gaps                      | "I hate that you keep reporting gaps instead of just finding a solution" (10-12)                           | Pair prompt Work: close every gap                                   |
