# Portfolio

Run `vp run preview portfolio` from the repository root for the public web app. The iPhone app shows the same profile and CV without sign-in; `portfolio:///cv` opens the CV directly.

On a Mac, run `vp run iphone:prepare` in this app, install the generated project's CocoaPods dependencies, and build its Release scheme in Xcode. Set `EXPO_PUBLIC_APP_URL` in `.env` before preparing or building to point the iPhone app and its updates at another HTTPS origin. The default is `https://portfolio.mp281x.xyz`. The matching `vp run build:iphone` exports the update served by Portfolio's server.
