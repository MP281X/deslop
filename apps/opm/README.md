# OPM

The One Punch Man and webcomic reader.

`vp run preview` builds and serves the web client and server. On a Mac, run `vp run iphone:prepare`, install the generated Xcode project's CocoaPods dependencies, and build its Release scheme. `vp run build:iphone` exports an update from the same generated project to match the installed app's fingerprint.

Set `EXPO_PUBLIC_APP_URL` in `.env` to the server's HTTPS origin (defaults to `https://opm.mp281x.xyz`), and `EXPO_PUBLIC_OPM_DEVELOPMENT=1` for the development bundle and Live Activity scheme. Register the signed bundle with Auth for GitHub sign-in. Chapter announcements are ActivityKit push-to-start notifications; there is no separate alert subscription.
