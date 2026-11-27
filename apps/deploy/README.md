# Deploy

Run the Deploy server on the Linux x64 machine it shows; public exposure uses the bundled Caddy.

After `vp install` at the workspace root, `vp run build` in the app puts the server, web client and iPhone update in `dist/`. Run `vp run preview deploy` at the root to serve the web client and server over the tailnet.

On a Mac, set `EXPO_PUBLIC_APP_URL` in the app's `.env` to the server's HTTPS origin (defaults to `https://deploy.mp281x.xyz`), run `vp run iphone:prepare` and install the generated project's CocoaPods dependencies. Build its Release scheme in Xcode. Use the same generated project and origin for `vp run build:iphone` so updates match the installed app's native fingerprint.

The iPhone uses Auth's tailnet identity or GitHub sign-in. GitHub sign-in requires Deploy's registration in Auth and a signed build with matching Associated Domains. Set `EXPO_PUBLIC_AUTH_URL` to select a different Auth origin.
