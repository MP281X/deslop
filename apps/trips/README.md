# Trips

Set `AEROAPI_KEY`, `APNS_KEY`, `APNS_KEY_ID` and `APNS_TEAM_ID` for live tracking and APNs. `vp run preview trips` from the repository root gives Trips a scratch server and web client.

The app uses Auth and downloads updates from Trips. On the Mac, set `EXPO_PUBLIC_APP_URL` in the app's `.env` to Trips' HTTPS origin (defaults to `https://trips.mp281x.xyz`). Set `EXPO_PUBLIC_TRIPS_DEV=1` there for the simulator bundle and APNs sandbox. Run `vp run iphone:prepare`, install the generated project's CocoaPods dependencies, then build it with Xcode. Keep the same origin and bundle setting for `vp run build:iphone` so the update matches the installed app.

The share extension sends tickets straight to Trips with the app's Auth session. APNs starts, updates and ends the next flight in the Dynamic Island; opening Trips registers the phone's alert and ActivityKit tokens.
