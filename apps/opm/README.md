# opm

The server behind the opm iOS app: One Punch Man chapters and reading progress.

```bash
npm install --global @deslop/opm
opm service install --url https://opm.mp281x.xyz --auth https://auth.mp281x.xyz --apns-key-id <id> --apns-team-id <team>
```

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).

New-chapter notifications go through the runtime's [APNs sender](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md#apns), with the same `APNS_KEY` Trips uses. The registered bundle picks the endpoint: `xyz.mp281x.opm` uses production and `xyz.mp281x.opm.dev` sandbox.
