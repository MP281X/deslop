# Gateway

Register `https://<gateway>/mcp` as the only server in each harness.

On the Mac, run `vp run ios:sync` in this app to build and bundle its web client, then build the **App** scheme in `ios/App/App.xcodeproj`. Set `DESLOP_SERVER` to an HTTPS origin to try another Gateway server.
