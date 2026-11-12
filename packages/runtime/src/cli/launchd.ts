import {userInfo} from 'node:os'
import {execPath} from 'node:process'

import {Array, Config, Effect, FileSystem, Option, Path, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {execute} from '#cli/command.ts'
import {AppError} from '#cli/schema.ts'

function xml(value: string) {
	return pipe(
		value,
		String.replaceAll('&', '&amp;'),
		String.replaceAll('<', '&lt;'),
		String.replaceAll('>', '&gt;'),
		String.replaceAll('"', '&quot;'),
		String.replaceAll("'", '&apos;')
	)
}

function domain() {
	return `gui/${userInfo().uid}`
}

function launchctl(...args: string[]) {
	return execute('launchctl', args)
}

const loaded = Effect.fnUntraced(function* (target: string) {
	const process = yield* ChildProcess.make('launchctl', ['print', target], {stderr: 'pipe', stdout: 'ignore'})
	const result = yield* Effect.all(
		{code: process.exitCode, stderr: Stream.mkString(Stream.decodeText(process.stderr))},
		{concurrency: 'unbounded'}
	)
	// launchctl error 113: "Could not find specified service".
	if (result.code === 113) return false
	if (result.code !== 0) return yield* AppError.make({message: `launchctl failed: ${result.stderr}`})
	return true
}, Effect.scoped)

const agentDirectory = Effect.gen(function* () {
	return (yield* Path.Path).join(yield* Config.String('HOME'), 'Library', 'LaunchAgents')
})

const writeAgent = Effect.fnUntraced(function* (label: string, name: string, command: string[], schedule: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.String('HOME')
	const directory = yield* agentDirectory
	const args = [execPath, `--env-file-if-exists=${home}/.deslop/${name}.env`, ...Array.drop(command, 1)]
	const file = path.join(directory, `${label}.plist`)
	yield* fs.makeDirectory(directory, {recursive: true})
	yield* fs.writeFileString(
		file,
		`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n<key>Label</key><string>${xml(label)}</string>\n<key>ProgramArguments</key>\n<array>\n${Array.join(
			Array.map(args, arg => `<string>${xml(arg)}</string>`),
			'\n'
		)}\n</array>\n<key>EnvironmentVariables</key>\n<dict>\n<key>NODE_ENV</key><string>production</string>\n<key>PATH</key><string>${xml(`${home}/.vite-plus/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>\n</dict>\n<key>Umask</key><integer>63</integer>\n${schedule}\n</dict>\n</plist>\n`,
		{mode: 0o600}
	)
	return file
})

export const installAgent = Effect.fnUntraced(function* (name: string, command: string[], options?: {restart: false}) {
	const label = `deslop-${name}`
	const target = `${domain()}/${label}`
	const file = yield* writeAgent(
		label,
		name,
		command,
		'<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>3</integer>'
	)
	if (yield* loaded(target)) {
		// kickstart without -k leaves a running helper alone, just like systemctl start.
		if (options?.restart === false) {
			yield* launchctl('kickstart', target)
			return `${label}.plist installed\n`
		}
		yield* launchctl('bootout', target)
	}
	yield* launchctl('bootstrap', domain(), file)
	return `${label}.plist installed\n`
})

// A separate agent survives kickstart of the app whose current link it promotes.
export const installUpdateAgent = Effect.fnUntraced(function* (name: string, command: string[]) {
	const label = `deslop-${name}-update`
	const target = `${domain()}/${label}`
	const file = yield* writeAgent(label, name, command, '<key>StartInterval</key><integer>900</integer>')
	if (yield* loaded(target)) yield* launchctl('bootout', target)
	yield* launchctl('bootstrap', domain(), file)
})

export const uninstallAgents = Effect.fnUntraced(function* (name: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* agentDirectory
	yield* Effect.forEach(
		[`deslop-${name}-update`, `deslop-${name}`],
		Effect.fnUntraced(function* (label) {
			const target = `${domain()}/${label}`
			if (yield* loaded(target)) yield* launchctl('bootout', target)
			yield* fs.remove(path.join(directory, `${label}.plist`), {force: true})
		}),
		{concurrency: 1}
	)
	return `deslop-${name}.plist removed; application data preserved\n`
})

export function agentStatus(name: string) {
	return pipe(
		launchctl('print', `${domain()}/deslop-${name}`),
		Effect.map(
			output =>
				`${Array.join(
					Array.map(
						Array.filter(String.split(output, '\n'), line =>
							Option.isSome(String.match(/^\s*(?:path|state|pid|last exit code|last terminating signal) =/u)(line))
						),
						String.trim
					),
					'\n'
				)}\n`
		)
	)
}

export function restartAgent(name: string) {
	return pipe(launchctl('kickstart', '-k', `${domain()}/deslop-${name}`), Effect.timeout('30 seconds'))
}
