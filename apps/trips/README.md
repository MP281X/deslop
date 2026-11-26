# Trips

Put `APNS_KEY` in `~/.deslop/trips.env`.

After `vp run build`, sync the iOS app with `vp exec cap sync ios`. Capacitor bundles `dist/client`; the Xcode build configuration sets the RPC and share server.
