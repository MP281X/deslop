# opm

The server behind the opm iOS app: One Punch Man chapters and reading progress.

```bash
npm install --global @deslop/opm
opm service install --url https://opm.mp281x.xyz --auth https://auth.mp281x.xyz --apns-key-id <id> --apns-team-id <team>
```

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).

New-chapter notifications use Apple's APNs directly. Expose the same `APNS_KEY` environment setting Trips uses: both apps read it unchanged through the shared sender as PKCS#8 PEM or base64 DER. `--apns-key-id` and `--apns-team-id` identify it; their environment settings are `APNS_KEY_ID` and `APNS_TEAM_ID`. The registered bundle determines the topic and endpoint: `xyz.mp281x.opm` uses production and `xyz.mp281x.opm.dev` uses sandbox.

Migration `0002_apns_devices` drops every stored Expo token. Each iPhone must open the updated app once to register its native token; until then it receives no notifications.
