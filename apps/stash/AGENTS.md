# Stash intent

- **Queue.** The share extension, clipboard and compose screen save to the same list.
- **Article.** Read and tag each saved link once, unless a failed note or Regenerate asks again.
- **AI.** Organise notes with the person's Anthropic key, not their catalogue balance. Transcribe audio with Zen when usable captions are missing. Keep usable speech even if part of the transcription fails. Treat audio as silent only when transcription confirms there is no speech.
- **Production.** The iPhone app and share sheet always use `https://stash.mp281x.xyz`, which `deslop-stash.service` serves on dev from production data in `~/.deslop/stash`; `vp run preview stash` serves a scratch copy they never reach.
- **Production notes.** Leave them untouched until someone loads them into SQL by hand.
