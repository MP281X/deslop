import {assert, it} from '@effect/vitest'

import {Array, HashMap, Option} from 'effect'

import {dockApplications, launchAgents, macApplications} from './launchd.ts'
import {launchdProcesses} from './processes.ts'

// Selected records from macbook-pro's `lsappinfo list` on 2026-11-15.
const APPLICATIONS = `42) "Safari" ASN:0x0-0x717717:
    bundleID="com.apple.Safari"
    bundle path="/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app"
    executable path="/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari"
    pid = 46331 token=[sess=100015 pid=46331 uid:501,501,501 g:20,20 pV:1363211] type="Foreground" flavor=3 Version="22625.2.8.11.9" fileType="APPL" creator="sfri" Arch=ARM64 sandboxed
43) "Logi Options+" ASN:0x0-0x80b80b:
    bundleID="com.logi.cp-dev-mgr"
    pid = 19351 token=[sess=100015 pid=19351 uid:501,501,501 g:20,20 pV:596891] type="UIElement" flavor=3 Version="2.9.1013853" fileType="APPL" creator="????" Arch=ARM64
54) "T3 Code (Nightly)" ASN:0x0-0xf196187: (in front)
    bundleID="com.t3tools.t3code"
    bundle path="/Applications/T3 Code (Nightly).app"
    executable path="/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)"
    pid = 77287 token=[sess=100015 pid=77287 uid:501,501,501 g:20,20 pV:4677758] type="Foreground" flavor=3 Version="0.1.10-nightly.20261114.4695" fileType="APPL" creator="????" Arch=ARM64`

const AGENTS = `PID\tStatus\tLabel
-\t0\tdeslop-deploy-update
4027\t0\tapplication.io.tailscale.ipn.macsys.1897138.1897143
92164\t0\tcom.openssh.ssh-agent
-\t0\tcom.discord.discord.ShipIt
77287\t0\tapplication.com.t3tools.t3code.9749154.9749160
46331\t0\tapplication.com.apple.Safari.164473.165139
73460\t130\tdeslop-deploy
19351\t0\tcom.logi.cp-dev-mgr
3660\t0\tcom.apple.pboard`

it('combines regular Dock applications and running third-party launch agents from Mac output', () => {
	const apps = macApplications(launchAgents(AGENTS), dockApplications(APPLICATIONS))
	assert.deepStrictEqual(
		Array.map(apps, app => [app.label, app.pid]),
		[
			['Safari', 46_331],
			['T3 Code (Nightly)', 77_287],
			['com.openssh.ssh-agent', 92_164],
			['deslop-deploy', 73_460],
			['com.logi.cp-dev-mgr', 19_351]
		]
	)
	assert.deepStrictEqual(macApplications([], [...apps, ...apps]), apps)
	// Real `ps` rows from the same machine, with the helper's arguments omitted.
	const records = launchdProcesses(
		`46331     1 111904 126:56.08 Mon Nov  9 09:04:01 2026     /System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari
77287     1 161696   7:42.47 Sat Nov 14 23:47:48 2026     /Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)
77327 77287  87856  11:38.03 Sat Nov 14 23:47:50 2026     /Applications/T3 Code (Nightly).app/Contents/Frameworks/T3 Code (Nightly) Helper.app/Contents/MacOS/T3 Code (Nightly) Helper`,
		HashMap.fromIterable(Array.map(apps, app => [app.pid, app.label] as const))
	)
	assert.deepStrictEqual(
		Array.map(records, record => [record.process.pid, Option.getOrThrow(record.owner)]),
		[
			[46_331, 'service:user:Safari'],
			[77_287, 'service:user:T3 Code (Nightly)'],
			[77_327, 'service:user:T3 Code (Nightly)']
		]
	)
})

it('skips unreadable app identities and keeps running agents without exit metadata', () => {
	assert.isEmpty(
		dockApplications(`1) "" ASN:0x0-0x1:
    pid = 12 type="Foreground"
2) "broken" ASN:0x0-0x2:
    pid = invalid type="Foreground"
3) "missing" ASN:0x0-0x3:
4) "background" ASN:0x0-0x4:
    pid = 13 type="BackgroundOnly"`)
	)
	assert.deepStrictEqual(
		Array.map(
			launchAgents('12\tgarbage\tthird-party\n-\t1\tstopped\n0\t0\tzero\n12\t0\t\n12junk\t0\tbroken'),
			app => app.label
		),
		['third-party', 'stopped']
	)
	assert.isEmpty(
		launchdProcesses(
			`12 13 100 0:01.00 Sat Nov 14 23:47:48 2026 /usr/bin/first
13 12 100 0:01.00 Sat Nov 14 23:47:48 2026 /usr/bin/second`,
			HashMap.empty()
		)
	)
})
