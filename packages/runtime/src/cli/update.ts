import {execPath} from 'node:process'

import {Array, Boolean, Effect, Exit, FileSystem, Number, Option, Path, Schedule, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {configDirectory} from '#cli/config.ts'
import {packageRoot, packageVersion} from '#cli/package.ts'
import {AppError, AppManifest} from '#cli/schema.ts'
import type {AppSettings} from '#cli/schema.ts'
import {execute, systemdArgument} from '#cli/service.ts'

export const lifecycleLock = Effect.fnUntraced(function* (name: string) {
	const fs = yield* FileSystem.FileSystem
	const root = yield* configDirectory(name)
	yield* fs.makeDirectory(root, {mode: 0o700, recursive: true})
	const file = `${root}/lifecycle.lock`
	yield* pipe(
		fs.open(file, {flag: 'wx', mode: 0o600}),
		Effect.mapError(cause =>
			AppError.make({
				cause,
				message: `Another lifecycle command holds ${file}; after a crash remove it only when no installer/updater is running`
			})
		)
	)
	yield* Effect.addFinalizer(() =>
		pipe(
			fs.remove(file),
			Effect.ignore({log: 'Warn', message: 'Could not remove the lifecycle lock; inspect it before retrying'})
		)
	)
})

export const probe = Effect.fnUntraced(function* (config: AppSettings, version: string) {
	const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
	return yield* pipe(
		client.get(
			`http://${Boolean.match(Array.contains(['::', '::1'], config.host), {onFalse: () => Boolean.match(config.host === '0.0.0.0', {onFalse: () => config.host, onTrue: () => '127.0.0.1'}), onTrue: () => '[::1]'})}:${config.port}/api/runtime`,
			{headers: {host: new URL(config.url).host}}
		),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(AppManifest)),
		Effect.flatMap(body => {
			if (body.version === version) return Effect.void
			return Effect.fail(AppError.make({message: 'Runtime probe answered from another release'}))
		}),
		Effect.retry({schedule: Schedule.spaced('1 second'), times: 20}),
		Effect.timeout('25 seconds')
	)
})

function newerVersion(latest: string, current: string) {
	return (
		Option.getOrElse(Number.parse(String.slice(4)(latest)), () => 0) >
		Option.getOrElse(Number.parse(String.slice(4)(current)), () => 0)
	)
}

export const managedEntry = Effect.fnUntraced(function* (name: string, entry: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* configDirectory(name)
	const destination = path.join(root, 'releases', yield* packageVersion(entry), 'node_modules', '@deslop', name)
	if (!(yield* fs.exists(destination))) {
		yield* fs.makeDirectory(path.dirname(destination), {mode: 0o700, recursive: true})
		const temporary = yield* fs.makeTempDirectoryScoped({directory: path.dirname(destination), prefix: 'install-'})
		const source = yield* packageRoot(entry)
		yield* fs.copy(path.join(source, 'dist'), path.join(temporary, 'dist'))
		if (yield* fs.exists(path.join(source, 'bin'))) {
			yield* fs.copy(path.join(source, 'bin'), path.join(temporary, 'bin'))
		}
		yield* fs.copyFile(path.join(source, 'package.json'), path.join(temporary, 'package.json'))
		yield* fs.rename(temporary, destination)
	}
	if (yield* fs.exists(path.join(root, 'current.next'))) yield* fs.remove(path.join(root, 'current.next'))
	yield* fs.symlink(destination, path.join(root, 'current.next'))
	yield* fs.rename(path.join(root, 'current.next'), path.join(root, 'current'))
	return path.join(root, 'current', 'dist', 'server.js')
})

// A separate systemd oneshot survives restarting the app it updates. It never mutates an npm/vp global installation.
export const updateTimer = Effect.fnUntraced(function* (
	name: string,
	executable: string,
	entry: string,
	remove: boolean
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = path.resolve(yield* configDirectory(name), '../../.config/systemd/user')
	const unit = `deslop-${name}-update`
	if (remove) {
		yield* execute('systemctl', ['--user', 'disable', '--now', `${unit}.timer`])
		yield* fs.remove(path.join(directory, `${unit}.timer`), {force: true})
		yield* fs.remove(path.join(directory, `${unit}.service`), {force: true})
	} else {
		yield* fs.writeFileString(
			path.join(directory, `${unit}.service`),
			`[Unit]\nDescription=Update Deslop ${name}\n\n[Service]\nType=oneshot\nExecStart=${systemdArgument(executable)} ${systemdArgument(entry)} service update\nUMask=0077\n`,
			{mode: 0o600}
		)
		yield* fs.writeFileString(
			path.join(directory, `${unit}.timer`),
			`[Unit]\nDescription=Update Deslop ${name}\n\n[Timer]\nOnBootSec=5min\nOnUnitInactiveSec=15min\nRandomizedDelaySec=1min\n\n[Install]\nWantedBy=timers.target\n`,
			{mode: 0o600}
		)
	}
	yield* execute('systemctl', ['--user', 'daemon-reload'])
	if (!remove) yield* execute('systemctl', ['--user', 'enable', '--now', `${unit}.timer`])
})

export const update = Effect.fnUntraced(function* (name: string, config: AppSettings) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* configDirectory(name)
	const current = path.join(root, 'current')
	yield* lifecycleLock(name)
	const previous = yield* fs.readLink(current)
	const version = (yield* pipe(
		(yield* HttpClient.HttpClient).get(`https://registry.npmjs.org/@deslop%2f${name}/latest`),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(AppManifest)),
		Effect.timeout('15 seconds')
	)).version
	const previousVersion = yield* packageVersion(path.join(previous, 'dist/server.js'))
	if (!newerVersion(version, previousVersion)) return 'Already current\n'
	if (
		(yield* fs.exists(`${root}/failed-version`)) &&
		String.trim(yield* fs.readFileString(`${root}/failed-version`)) === version
	) {
		return `Release ${version} previously failed; waiting for a newer release\n`
	}
	const directory = path.join(root, 'releases', version)
	const target = path.join(directory, 'node_modules/@deslop', name)
	const npm = path.resolve(path.dirname(execPath), '../lib/node_modules/npm/bin/npm-cli.js')
	if (!(yield* fs.exists(npm))) {
		return yield* AppError.make({
			message: 'This Node runtime does not include npm; keep the current release and install Node with Vite+'
		})
	}
	yield* pipe(
		execute(execPath, [
			npm,
			'install',
			'--prefix',
			directory,
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--omit=dev',
			'--registry=https://registry.npmjs.org',
			`@deslop/${name}@${version}`
		]),
		Effect.timeout('5 minutes')
	)
	yield* execute(execPath, [path.join(target, 'dist/server.js'), '--help'])
	if ((yield* packageVersion(path.join(target, 'dist/server.js'))) !== version) {
		return yield* AppError.make({message: 'Prepared package version does not match the registry release'})
	}
	return yield* Effect.uninterruptibleMask(restore =>
		Effect.gen(function* () {
			yield* fs.remove(`${root}/previous.next`, {force: true})
			yield* fs.symlink(previous, `${root}/previous.next`)
			yield* fs.rename(`${root}/previous.next`, `${root}/previous`)
			yield* fs.remove(`${current}.next`, {force: true})
			yield* fs.symlink(target, `${current}.next`)
			yield* fs.rename(`${current}.next`, current)
			const result = yield* Effect.exit(
				restore(
					pipe(
						execute('systemctl', ['--user', 'restart', `deslop-${name}.service`]),
						Effect.timeout('30 seconds'),
						Effect.andThen(probe(config, version))
					)
				)
			)
			if (Exit.isFailure(result)) {
				yield* fs.symlink(previous, `${current}.next`)
				yield* fs.rename(`${current}.next`, current)
				yield* fs.writeFileString(`${root}/failed-version`, version, {mode: 0o600})
				yield* pipe(execute('systemctl', ['--user', 'restart', `deslop-${name}.service`]), Effect.timeout('30 seconds'))
				yield* Effect.logWarning('New release failed; restored the previous code and quarantined this version')
				return yield* Effect.failCause(result.cause)
			}
			yield* fs.remove(`${root}/failed-version`, {force: true})
			yield* pipe(
				Effect.forEach(
					Array.filter(
						yield* fs.readDirectory(path.join(root, 'releases')),
						entry => Schema.is(AppManifest)({version: entry}) && entry !== version && entry !== previousVersion
					),
					entry => fs.remove(path.join(root, 'releases', entry), {recursive: true}),
					{concurrency: 1}
				),
				Effect.ignore({log: 'Warn', message: 'Could not prune obsolete code releases'})
			)
			return `Updated ${name} to ${version}\n`
		})
	)
})
