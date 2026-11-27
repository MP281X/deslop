# Gateway

Register `https://<gateway>/mcp` as the only server in each harness.

Run `vp run build` to package the server, web client and iPhone update in `dist/`. On the Mac, run `vp run iphone:prepare` and install the generated project's CocoaPods dependencies before building the **Gateway** Release scheme. Set `EXPO_PUBLIC_APP_URL` in the app's `.env` to try another Gateway HTTPS origin. Use the same generated project and origin when exporting updates.
