import {Array, Config, Effect, FileSystem, Path, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {AppError} from '#cli/schema.ts'

// systemd expands percent specifiers even inside a quoted argument.
export function systemdArgument(value: string) {
	return `"${pipe(value, String.replaceAll('\\', '\\\\'), String.replaceAll('"', '\\"'), String.replaceAll('%', '%%'), String.replaceAll('$', '$$$$'), String.replaceAll('\n', '\\n'), String.replaceAll('\r', '\\r'))}"`
}

export const execute = Effect.fnUntraced(function* (command: string, args: string[]) {
	const process = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	const result = yield* Effect.all(
		{
			code: process.exitCode,
			stderr: Stream.mkString(Stream.decodeText(process.stderr)),
			stdout: Stream.mkString(Stream.decodeText(process.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (result.code !== 0) return yield* AppError.make({message: `${command} failed: ${result.stderr}`})
	return result.stdout
})

export const service = Effect.fnUntraced(function* (
	name: string,
	action: 'install' | 'uninstall' | 'status',
	executable: string,
	entry: string,
	args: string[]
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.String('HOME')
	const directory = path.join(home, '.config', 'systemd', 'user')
	const unit = `deslop-${name}.service`
	const file = path.join(directory, unit)
	if (action === 'install') {
		yield* fs.makeDirectory(directory, {recursive: true})
		yield* fs.writeFileString(
			file,
			`[Unit]\nDescription=Deslop ${name}\nAfter=network-online.target\n\n[Service]\nType=simple\nEnvironment=NODE_ENV=production\nEnvironment=${systemdArgument(`PATH=${home}/.vite-plus/bin:/usr/local/bin:/usr/bin:/bin`)}\nEnvironmentFile=-${systemdArgument(`${home}/.deslop/${name}.env`)}\nExecStart=${Array.join(Array.map([executable, entry, ...args], systemdArgument), ' ')}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`,
			{mode: 0o600}
		)
		yield* execute('systemctl', ['--user', 'daemon-reload'])
		yield* execute('systemctl', ['--user', 'enable', unit])
		yield* execute('systemctl', ['--user', 'restart', unit])
		return `${unit} installed\n`
	}
	if (action === 'uninstall') {
		yield* execute('systemctl', ['--user', 'disable', '--now', unit])
		yield* fs.remove(file)
		yield* execute('systemctl', ['--user', 'daemon-reload'])
		return `${unit} removed; application data preserved\n`
	}
	return yield* execute('systemctl', ['--user', 'show', unit, '--property=LoadState,ActiveState,SubState,MainPID'])
})
