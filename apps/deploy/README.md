# Deploy

Run the Deploy server on the Linux x64 machine it shows; public exposure uses the bundled Caddy.

On the Mac, run `vp run ios:sync` to build and bundle `dist/client`. Open
`ios/App/App.xcodeproj` in Xcode and build the **App** scheme. Set
`DESLOP_SERVER` to the HTTPS origin of another Deploy server to test it.
Outside the tailnet, GitHub sign-in requires Deploy's registration in Auth
and a signed build with the matching Associated Domains entitlement.
