# Stash

Set `STASH_PROXY`, the upstream media proxy, in `~/.deslop/stash.env`, since its URL carries credentials: the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

For Live Activities, give Stash's server `APNS_KEY`, `APNS_KEY_ID` and `APNS_TEAM_ID`. Open the iPhone app once so the share extension has a push-to-start token.

On a Mac, run `vp run iphone:prepare`, then `pod install` in the generated `ios/` folder. Build the Release scheme in Xcode. The app and share extension use the same HTTPS Stash server, App Group, and Auth Keychain group. `EXPO_PUBLIC_APP_URL` defaults to `https://stash.mp281x.xyz`; use a scratch HTTPS origin to prove shares without changing production notes.
