# Stash intent

- **Queue.** One list: the share extension, clipboard and compose screen all save into it.
- **Article.** Stash reads and tags each saved link once.
- **AI.** Organization uses Claude Haiku 5.5 through the Anthropic account connected in OpenCode Console, not the catalogue balance. Audio without usable captions uses Zen's Gemini 3.5 Flash Lite with two-minute 16 kHz mono s16 FLAC chunks and timestamped sentence segments. A failed or unusable chunk is logged and keeps its elapsed time; usable chunks stand, and out-of-chunk timestamps are dropped and logged. Only an explicit no-speech answer is silence; any other transcript without segments is a media failure.
- **Audio timing.** FFmpeg's segment-list CSV owns chunk boundaries: raw FLAC headers can omit their duration or retain the whole input's duration, so probing those headers cannot time chunks.
- **Changes.** Note transitions are pure functions; the Notes service alone stores their results. Production notes stay untouched until loaded into SQL by hand.
