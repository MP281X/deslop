import {platform} from 'node:process'

import {
	Array,
	Boolean,
	Config,
	Effect,
	FileSystem,
	Function,
	Option,
	Order,
	Path,
	Predicate,
	String,
	pipe
} from 'effect'

import {agentStatus, installAgent, installUpdateAgent, restartAgent, uninstallAgents} from '#server/launchd.ts'
import {executeProcess} from '#server/process.ts'

// The apps' own slice, beside the app.slice where agents run: under contention the apps get ten times an agent's CPU share, and reclaim spares their first gigabyte. Both weigh only what the apps use, so idle apps take nothing from agents.
const SLICE = 'deslop.slice'

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
		path.join(directory, SLICE),
		'[Unit]\nDescription=Deslop apps\n\n[Slice]\nCPUWeight=1000\nMemoryLow=1G\n',
		{mode: 0o600}
	)
	yield* fs.writeFileString(
		path.join(directory, unit),
		`[Unit]\nDescription=Deslop ${name}\nAfter=network-online.target\n\n[Service]\nType=simple\nSlice=${SLICE}\nEnvironment=NODE_ENV=production\nEnvironment=${systemdArgument(`PATH=${home}/.vite-plus/bin:/usr/local/bin:/usr/bin:/bin`)}\nEnvironmentFile=-${String.replaceAll('%', '%%')(`${home}/.deslop/${name}.env`)}\nExecStart=${pipe(command, Array.map(systemdArgument), Array.join(' '))}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`,
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

// A separate oneshot, so updating survives the restart of the app it updates. Its timer checks once at boot; Release starts it through Deploy after each publish.
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
		`[Unit]\nDescription=Update Deslop ${name}\n\n[Timer]\nOnBootSec=5min\n\n[Install]\nWantedBy=timers.target\n`,
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
	// The timer's oneshot may already be running; stopping waits for it, as launchd's bootout does for its agent.
	yield* systemctl('stop', `deslop-${name}-update.service`)
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

// Starts every installed app's update without waiting for it; each installs a newer release from npm if there is one. Deploy, which calls this, runs only on Linux.
export const startUpdates = Effect.fnUntraced(function* () {
	const directory = yield* unitDirectory
	const units = pipe(
		yield* Effect.catchTag((yield* FileSystem.FileSystem).readDirectory(directory), 'PlatformError', cause => {
			if (Predicate.isTagged(cause.reason, 'NotFound')) return Effect.succeed(Array.empty<string>())
			return Effect.fail(cause)
		}),
		Array.filter(file => Option.isSome(String.match(/^deslop-[a-z0-9-]+-update\.service$/u)(file))),
		Array.sort(Order.String)
	)
	if (Array.isReadonlyArrayNonEmpty(units)) yield* systemctl('start', '--no-block', ...units)
	return units
})
