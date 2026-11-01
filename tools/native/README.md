# Native tools

The Linux x64 executables are versioned here as per-tool xz-compressed tar archives, with licenses, source references and archive checksums. App builds only extract these checked-in artifacts; they never download native tools. `apps/*/bin` and `release/bin` are disposable extracted output, not another source of truth.

| Tool             | Version                    | Owner  |
| ---------------- | -------------------------- | ------ |
| Caddy            | 2.11.7                     | Deploy |
| FFmpeg / ffprobe | 9.0.2, revision d7643a0fe3 | Stash  |
| yt-dlp           | 2026.10.26                 | Stash  |

FFmpeg executables exceed GitHub's individual-file limit uncompressed; separate archives keep each tracked blob below that limit without Git LFS. Updates are deliberate, not a build or install side effect.

## Manual update

1. Pick an upstream release deliberately. Use the existing `linux-x64/*-SOURCES.txt` URLs as the starting point; obtain that release's Linux x64 binaries, checksums, license texts and source/build references from the upstream release. Verify upstream checksums before extraction. Keep Python bundled in yt-dlp's Linux executable; do not substitute its Python script.
2. In a scratch directory, place executable `caddy` beside its `LICENSE`; `yt-dlp` beside `yt-dlp-LICENSES.txt`; and `ffmpeg` / `ffprobe`. Preserve executable permissions. Repack from that directory:

   ```bash
   tar -cJf <repo>/tools/native/linux-x64/caddy.tar.xz caddy LICENSE
   tar -cJf <repo>/tools/native/linux-x64/yt-dlp.tar.xz yt-dlp yt-dlp-LICENSES.txt
   tar -cJf <repo>/tools/native/linux-x64/ffmpeg.tar.xz ffmpeg
   tar -cJf <repo>/tools/native/linux-x64/ffprobe.tar.xz ffprobe
   ```

3. Update this version table, the `*-SOURCES.txt` records and `ffmpeg-LICENSE.txt` when affected. Retain the GPL and bundled Python/dependency redistribution notices and corresponding source access. From `tools/native/linux-x64`, record `sha256sum *.tar.xz > SHA256SUMS` and verify `sha256sum --check SHA256SUMS`. Check each archive remains below 100 MiB.
4. Build the owning app, pack its `release/` directory, and run the CLI and every bundled executable from that tarball and its common container image. Run repository Verify. Commit the changed archives, notices, source records and checksums together; publishing follows `RELEASING.md`.
