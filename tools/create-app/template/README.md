# template-app

After generating the app, run `vp install` at the workspace root. `vp run build` in the app puts the server, web client and iPhone update in `dist/` for one npm package. Run `vp run preview` to build and serve just the web client and server.

On a Mac, set `EXPO_PUBLIC_APP_URL` in the app's `.env` to the server's HTTPS origin (defaults to `https://template-app.mp281x.xyz`), then run `vp run iphone:prepare` and install the generated project's CocoaPods dependencies. Build its Release scheme in Xcode. Use the same generated iOS project and origin for `vp run build:iphone`; the update must match the installed app's native fingerprint. Expo runs locally; there is no Expo account or service. Links such as `template-app:///items/first` open the same item as `/items/first` on the web.

The iPhone uses Auth's tailnet identity. Common service commands live in the [runtime contract](../../packages/runtime/README.md).
