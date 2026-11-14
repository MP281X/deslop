import {platform} from 'node:process'

import {Array, Boolean, Config, Effect, FileSystem, Function, Path, String, pipe} from 'effect'

import {agentStatus, installAgent, installUpdateAgent, restartAgent, uninstallAgents} from '#server/launchd.ts'
import {executeProcess} from '#server/process.ts'

// systemd expands percent specifiers even inside a quoted argument.
function systemdArgument(value: string) {
	return `"${pipe(value, String.replaceAll('\\', '\\\\'), String.replaceAll('"', '\\"'), String.replaceAll('%', '%%'), String.replaceAll('$', '$$$$'), String.replaceAll('\n', '\\n'), String.replaceAll('\r', '\\r'))}"`
}

function systemctl(...args: string[]) {
	return executeProcess('systemctl', ['--user', ...args])
}

const unitDirectory = Effect.gen(function* () {
	return (yield* Path.Path).join(yield* Config.String('HOME'), '.config', 'systemd', 'user')
})

// `restart: false` leaves a running process alone, for one that reloads its own configuration.
export const installService = Effect.fnUntraced(function* (
	name: string,
	command: string[],
	options?: {restart: false}
) {
	if (platform === 'darwin') return yield* installAgent(name, command)
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.String('HOME')
	const directory = yield* unitDirectory
	const unit = `deslop-${name}.service`
	yield* fs.makeDirectory(directory, {recursive: true})
	yield* fs.writeFileString(
		path.join(directory, unit),
		`[Unit]\nDescription=Deslop ${name}\nAfter=network-online.target\n\n[Service]\nType=simple\nEnvironment=NODE_ENV=production\nEnvironment=${systemdArgument(`PATH=${home}/.vite-plus/bin:/usr/local/bin:/usr/bin:/bin`)}\nEnvironmentFile=-${String.replaceAll('%', '%%')(`${home}/.deslop/${name}.env`)}\nExecStart=${pipe(command, Array.map(systemdArgument), Array.join(' '))}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`,
		{mode: 0o600}
	)
	yield* systemctl('daemon-reload')
	yield* systemctl('enable', unit)
	yield* systemctl(
		Boolean.match(options?.restart === false, {
			onFalse: Function.constant('restart'),
			onTrue: Function.constant('start')
		}),
		unit
	)
	return `${unit} installed\n`
})

// A separate oneshot, so updating survives the restart of the app it updates.
export const installUpdateService = Effect.fnUntraced(function* (name: string, command: string[]) {
	if (platform === 'darwin') return yield* installUpdateAgent(name, command)
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* unitDirectory
	const unit = `deslop-${name}-update`
	yield* fs.writeFileString(
		path.join(directory, `${unit}.service`),
		`[Unit]\nDescription=Update Deslop ${name}\n\n[Service]\nType=oneshot\nExecStart=${pipe(command, Array.map(systemdArgument), Array.join(' '))}\nUMask=0077\n`,
		{mode: 0o600}
	)
	yield* fs.writeFileString(
		path.join(directory, `${unit}.timer`),
		`[Unit]\nDescription=Update Deslop ${name}\n\n[Timer]\nOnBootSec=5min\nOnUnitInactiveSec=15min\nRandomizedDelaySec=1min\n\n[Install]\nWantedBy=timers.target\n`,
		{mode: 0o600}
	)
	yield* systemctl('daemon-reload')
	yield* systemctl('enable', '--now', `${unit}.timer`)
})

export const uninstallService = Effect.fnUntraced(function* (name: string) {
	if (platform === 'darwin') return yield* uninstallAgents(name)
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* unitDirectory
	yield* systemctl('disable', '--now', `deslop-${name}-update.timer`, `deslop-${name}.service`)
	yield* Effect.forEach(
		[`deslop-${name}.service`, `deslop-${name}-update.service`, `deslop-${name}-update.timer`],
		file => fs.remove(path.join(directory, file), {force: true}),
		{concurrency: 1}
	)
	yield* systemctl('daemon-reload')
	return `deslop-${name}.service removed; application data preserved\n`
})

export function serviceStatus(name: string) {
	if (platform === 'darwin') return agentStatus(name)
	return systemctl('show', `deslop-${name}.service`, '--property=LoadState,ActiveState,SubState,MainPID')
}

export function restartService(name: string) {
	if (platform === 'darwin') return restartAgent(name)
	return Effect.timeout(systemctl('restart', `deslop-${name}.service`), '30 seconds')
}
