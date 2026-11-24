# An app's App Store profiles against the entitlements its production config declares, for App Store signing and iPhone builds.
# `python3 app-store-profiles.py <mode> <config>`, with ASC_TOKEN set and <config> written by `expo config --type introspect --json`:
#   check: fail unless every target has App Store profiles and each holds its declared entitlements; changes nothing.
#   prepare: enable declared Associated Domains, delete profiles missing an entitlement, and output whether signing has anything to set up.
#   verify: fail unless the profiles created since prepare hold their declared entitlements.
import base64
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

api = "https://api.appstoreconnect.apple.com/v1"
temp = Path(os.environ["RUNNER_TEMP"])
mode, config_path = sys.argv[1], sys.argv[2]

def request(url, method="GET", payload=None):
    if not url.startswith(f"{api}/"):
        raise ValueError(f"Unexpected App Store Connect URL: {url}")
    headers = {"Authorization": f'Bearer {os.environ["ASC_TOKEN"]}', "Content-Type": "application/json"}
    body = json.dumps(payload).encode() if payload is not None else None
    try:
        return urlopen(Request(url, data=body, headers=headers, method=method))
    except HTTPError as error:
        fail(f"Apple {method} {url} returned {error.code}: {error.read().decode(errors='replace').strip()}")

def records(path):
    url = f"{api}/{path}"
    while url:
        with request(url) as response:
            page = json.load(response)
        yield from page["data"]
        url = page["links"].get("next")

def entitlements(profile):
    plist = subprocess.run(
        ["openssl", "cms", "-verify", "-inform", "DER", "-noverify"],
        input=base64.b64decode(profile["attributes"]["profileContent"], validate=True),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,
    ).stdout
    return plistlib.loads(plist)["Entitlements"]

def fail(message):
    sys.exit(f"::error::{message}")

config = json.loads(Path(config_path).read_text())
app = config["slug"]
main = config["ios"]["bundleIdentifier"]
targets = {main: config["_internal"]["modResults"]["ios"]["entitlements"]}
for extension in config["extra"]["eas"].get("build", {}).get("experimental", {}).get("ios", {}).get("appExtensions", []):
    targets[extension["bundleIdentifier"]] = extension.get("entitlements") or {}

query = urlencode({"filter[identifier]": ",".join(targets), "limit": 200})
bundles = {bundle["attributes"]["identifier"]: bundle["id"] for bundle in records(f"bundleIds?{query}")}
profiles = {identifier: [] for identifier in targets}
for identifier in targets:
    if identifier not in bundles:
        continue
    bundle_id = bundles[identifier]
    profiles[identifier] = [
        profile for profile in records(f"bundleIds/{bundle_id}/profiles?limit=200")
        if profile["attributes"]["profileType"] == "IOS_APP_STORE"
    ]

# Compare keys, not values: profiles can authorize wildcards, and distribution uses a different aps-environment.
def missing(identifier, profile):
    return sorted(targets[identifier].keys() - entitlements(profile).keys())

if mode == "check":
    signing = f'run App Store signing: gh workflow run app-store-signing.yaml --ref {os.environ["GITHUB_REF_NAME"]} -f app={app}'
    problems = [f"no App Store profile for {identifier}" for identifier, existing in profiles.items() if not existing]
    problems += [
        f'{identifier}\'s profile {profile["attributes"]["name"]} lacks {", ".join(absent)}'
        for identifier, existing in profiles.items() for profile in existing if (absent := missing(identifier, profile))
    ]
    if problems:
        fail(f'{app}: {"; ".join(problems)}. To sign it, {signing}')
    print(f'- {app}: App Store profiles hold every declared entitlement')
    sys.exit(0)

snapshot = temp / "signing-profile-ids.json"
if mode == "verify":
    before = json.loads(snapshot.read_text())
    for identifier, existing in profiles.items():
        if not existing:
            fail(f"No App Store profile for {identifier} after setup")
        created = [profile for profile in existing if profile["id"] not in before[identifier]]
        for profile in created:
            absent = missing(identifier, profile)
            print(f'Created {identifier}: {profile["attributes"]["name"]} ({profile["id"]})')
            if absent:
                fail(f'New profile for {identifier} lacks {", ".join(absent)}')
            print(f'{identifier}: all declared entitlements present ({", ".join(sorted(targets[identifier]))})')
    sys.exit(0)

signed = [identifier for identifier, existing in profiles.items() if existing]
unsigned = [identifier for identifier, existing in profiles.items() if not existing]
if signed and unsigned:
    fail(f'Partly signed: App Store profiles for {", ".join(signed)}, none for {", ".join(unsigned)}. Delete the App Store profiles of {", ".join(signed)} at https://developer.apple.com/account/resources/profiles/list, then run this workflow again.')

# A non-interactive release can enter the main target before EAS authenticates to Apple.
for identifier in signed:
    if "com.apple.developer.associated-domains" not in targets[identifier]:
        continue
    bundle_id = bundles[identifier]
    if any(
        capability["attributes"]["capabilityType"] == "ASSOCIATED_DOMAINS"
        for capability in records(f"bundleIds/{bundle_id}/bundleIdCapabilities")
    ):
        continue
    payload = {"data": {
        "type": "bundleIdCapabilities",
        "attributes": {"capabilityType": "ASSOCIATED_DOMAINS"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_id}}},
    }}
    with request(f"{api}/bundleIdCapabilities", "POST", payload) as response:
        capability = json.load(response)["data"]
        print(f'Enabled Associated Domains for {identifier} ({capability["id"]})')

stale = []
for identifier, existing in profiles.items():
    for profile in existing:
        absent = missing(identifier, profile)
        if absent:
            stale.append((identifier, profile, absent))

# An app signed with every declared entitlement goes straight on to its App Store record.
sign = not signed or bool(stale)
if not sign:
    print(f'Already signed for the App Store: {", ".join(signed)}')

snapshot.write_text(json.dumps({identifier: [p["id"] for p in existing] for identifier, existing in profiles.items()}))
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    print(f"sign={int(sign)}", file=output)
    print(f"refresh={int(bool(stale))}", file=output)
for identifier, profile, absent in stale:
    with request(f'{api}/profiles/{profile["id"]}', "DELETE"):
        print(f'Deleted {identifier}: {profile["attributes"]["name"]} ({profile["id"]}); missing {", ".join(absent)}')
