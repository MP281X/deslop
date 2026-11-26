# template-app

`vp run build` builds the web client and the Effect RPC server on Linux or macOS. Common service commands live in the [runtime contract](../../packages/runtime/README.md).

On the Mac, install workspace dependencies, then run `vp run ios:add` from this app once to generate its Capacitor iOS project. Run `vp run ios:sync` after web changes to rebuild and copy `dist/client` into the app. Open `ios/App/App.xcodeproj` in Xcode and build the **App** scheme.

Set `DESLOP_SERVER` to the HTTPS origin of this app's server when testing another deployment. GitHub sign-in outside the tailnet also needs an Auth registration for this app and a signed build with the matching Associated Domains entitlement.
