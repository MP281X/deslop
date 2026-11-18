import {execPath} from 'node:process'

import {SqliteClient} from '@effect/sql-sqlite-node'

import {
	Array,
	Boolean,
	Cause,
	Config,
	Effect,
	Exit,
	FileSystem,
	Option,
	Path,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {SqlError} from 'effect/sql'

import {AppError, executeProcess} from '#server/process.ts'
import {restartService} from '#server/services.ts'
import {AppVersion, RUNTIME_PATH, RuntimeConfig} from '#shared/schema.ts'

const serviceDirectory = Effect.fnUntraced(function* (name: string) {
	return (yield* Path.Path).join(yield* Config.String('HOME'), '.deslop', name)
})

// Install, update and uninstall of one app take turns; SQLite's write lock is held by the kernel, so a killed holder never leaves it behind.
export function withLifecycleLock(name: string) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		pipe(
			Effect.gen(function* () {
				const directory = yield* serviceDirectory(name)
				yield* (yield* FileSystem.FileSystem).makeDirectory(directory, {mode: 0o700, recursive: true})
				const sql = yield* SqliteClient.make({
					busyTimeout: 0,
					disableWAL: true,
					filename: (yield* Path.Path).join(directory, 'lifecycle.sqlite')
				})
				yield* Effect.acquireRelease(
					Effect.mapError(sql`BEGIN IMMEDIATE`, cause =>
						AppError.make({
							cause,
							message: Boolean.match(Schema.is(SqlError.LockTimeoutError)(cause.reason), {
								onFalse: () => `The ${name} lifecycle lock could not be taken`,
								onTrue: () => `Another install, update or uninstall of ${name} is running; try again when it ends`
							})
						})
					),
					() => Effect.ignore(sql`ROLLBACK`, {log: 'Warn', message: 'The lifecycle lock was released by closing it'})
				)
				return yield* effect
			}),
			Effect.scoped,
			Effect.provideServiceEffect(Reactivity.Reactivity, Reactivity.make)
		)
}

// A wildcard listener answers on loopback, and an IPv6 address needs brackets in a URL.
function authorityOf(host: string) {
	if (host === '0.0.0.0') return '127.0.0.1'
	if (host === '::') return '[::1]'
	if (String.includes(':')(host)) return `[${host}]`
	return host
}

// The address the updater asks for the version, built before anything is installed.
export function runtimeUrl(host: string, port: string) {
	return pipe(
		Option.liftThrowable(() => new URL(RUNTIME_PATH, `http://${authorityOf(host)}:${port}`).href)(),
		Effect.fromOption,
		Effect.mapError(() => AppError.make({message: `The service's host ${host} and port ${port} name no address`}))
	)
}

// The updater runs npm beside the Node that runs the service; a Node without it can never update.
export const updaterNpm = Effect.gen(function* () {
	const path = yield* Path.Path
	const npm = path.resolve(path.dirname(execPath), '../lib/node_modules/npm/bin/npm-cli.js')
	if (!(yield* (yield* FileSystem.FileSystem).exists(npm))) {
		return yield* AppError.make({message: `${execPath} does not include npm; install Node with Vite+`})
	}
	return npm
})

export const activateRelease = Effect.fnUntraced(function* (name: string, target: string) {
	const fs = yield* FileSystem.FileSystem
	const directory = yield* serviceDirectory(name)
	const current = (yield* Path.Path).join(directory, 'current')
	yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
	yield* fs.remove(`${current}.next`, {force: true})
	yield* fs.symlink(target, `${current}.next`)
	yield* fs.rename(`${current}.next`, current)
	return current
})

const serving = Effect.fnUntraced(function* (url: string, name: string, version: AppVersion) {
	return yield* pipe(
		HttpClient.get(url),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
		Effect.filterOrFail(
			release => release.name === name && release.version === version,
			() => AppError.make({message: `${name} ${version} is not serving yet`})
		),
		Effect.timeout('2 seconds'),
		Effect.retry({
			schedule: Schedule.spaced('1 second'),
			while: error => Array.contains(['HttpClientError', 'SchemaError', 'AppError', 'TimeoutError'], error._tag)
		}),
		Effect.timeout('30 seconds')
	)
})

// Never two processes: the service manager stops the old one before starting the new. Callers hold the lifecycle lock.
export const updateRelease = Effect.fnUntraced(function* (name: string, url: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* serviceDirectory(name)
	const running = (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({version: AppVersion})))(
		yield* fs.readFileString(path.join(root, 'current', 'package.json'))
	)).version
	const latest = (yield* pipe(
		HttpClient.filterStatusOk(yield* HttpClient.HttpClient).get(`https://registry.npmjs.org/@deslop%2f${name}/latest`),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({version: AppVersion}))),
		Effect.timeout('15 seconds')
	)).version
	if (latest === running) return `${name} ${running} is current\n`
	const npm = yield* updaterNpm
	const releases = path.join(root, 'releases')
	const directory = path.join(releases, latest)
	const previous = yield* fs.readLink(path.join(root, 'current'))
	yield* fs.makeDirectory(releases, {mode: 0o700, recursive: true})
	// npm writes into a fresh directory that becomes the release only once it holds the whole package.
	const staging = yield* fs.makeTempDirectory({directory: releases, prefix: '.staging-'})
	yield* Effect.ensuring(
		Effect.gen(function* () {
			yield* executeProcess(
				execPath,
				[
					npm,
					'install',
					'--prefix',
					staging,
					'--ignore-scripts',
					'--no-audit',
					'--no-fund',
					'--omit=dev',
					// npm's cached package metadata can predate the release /latest just named, which fails as "No matching version".
					'--prefer-online',
					'--registry=https://registry.npmjs.org',
					`@deslop/${name}@${latest}`
				],
				{timeout: '5 minutes'}
			)
			const installed = path.join(staging, 'node_modules', '@deslop', name)
			const version = (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({version: AppVersion})))(
				yield* fs.readFileString(path.join(installed, 'package.json'))
			)).version
			if (version !== latest || !(yield* fs.exists(path.join(installed, 'dist', 'server.js')))) {
				return yield* AppError.make({message: `npm did not install ${name} ${latest}`})
			}
			yield* fs.remove(directory, {force: true, recursive: true})
			yield* fs.rename(staging, directory)
		}),
		Effect.ignore(fs.remove(staging, {force: true, recursive: true}), {
			log: 'Warn',
			message: 'An npm staging directory was left behind'
		})
	)
	yield* Effect.uninterruptible(
		Effect.gen(function* () {
			yield* activateRelease(name, path.join(directory, 'node_modules', '@deslop', name))
			const promoted = yield* Effect.exit(Effect.andThen(restartService(name), serving(url, name, latest)))
			if (Exit.isSuccess(promoted)) return
			// The previous release runs again on the data the new one may have migrated, so it is proven, not assumed.
			const restored = yield* pipe(
				activateRelease(name, previous),
				Effect.andThen(restartService(name)),
				Effect.andThen(serving(url, name, running)),
				Effect.exit
			)
			return yield* AppError.make({
				cause: promoted.cause,
				message: `${name} ${latest} did not start serving: ${Cause.pretty(promoted.cause)}. ${Exit.match(restored, {
					onFailure: cause =>
						`${name} ${running} did not start serving again either; the service is down: ${Cause.pretty(cause)}`,
					onSuccess: () => `${name} ${running} is serving again`
				})}`
			})
		})
	)
	const kept = [latest, path.basename(path.resolve(root, previous, '../../..'))]
	yield* pipe(
		yield* fs.readDirectory(releases),
		Array.difference(kept),
		Effect.forEach(entry => fs.remove(path.join(releases, entry), {recursive: true}), {concurrency: 1})
	)
	return `Updated ${name} from ${running} to ${latest}\n`
})
