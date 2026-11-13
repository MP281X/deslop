# Stash intent

- **Queue.** One list: the share extension, clipboard and compose screen all save into it.
- **Article.** Stash reads and tags each saved link once.
- **AI.** Organization uses Claude Haiku 5.5 through the Anthropic account connected in OpenCode Console, not the catalogue balance. Audio without usable captions uses Zen's Gemini 3.5 Flash Lite with two-minute 16 kHz mono s16 FLAC chunks and timestamped sentence segments. Refused, timed-out, non-2xx or unusable chunks are logged and retain their elapsed time; usable chunks stand, and out-of-chunk timestamps are dropped and logged. Speech with no segments is a media failure. Only explicit no-speech answers count as silence; every chunk failing is a media failure, never a silent recording.
- **Audio timing.** FFmpeg's segment-list CSV owns chunk boundaries: raw FLAC headers can omit their duration or retain the whole input's duration, so probing those headers cannot time chunks.
- **Changes.** Note transitions are pure functions; the Notes service alone stores their results. Production notes stay untouched until loaded into SQL by hand.

## Journeys

- **Share.** Sign in, then share a link from Safari: the extension saves it with the app's session and it joins the list.
- **Retry.** Open an unreadable note: it says why, keeps what was read and offers retry.
- **Delete.** Remove a note by swipe, menu or from its detail; Undo stays in the row.
