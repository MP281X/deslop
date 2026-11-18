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

// `current` is what the unit runs; `serving` is the last release that answered as itself, which every rollback returns to.
const linkRelease = Effect.fnUntraced(function* (name: string, link: string, target: string) {
	const fs = yield* FileSystem.FileSystem
	const directory = yield* serviceDirectory(name)
	const linked = (yield* Path.Path).join(directory, link)
	yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
	yield* fs.remove(`${linked}.next`, {force: true})
	yield* fs.symlink(target, `${linked}.next`)
	yield* fs.rename(`${linked}.next`, linked)
	return linked
})

export function activateRelease(name: string, target: string) {
	return linkRelease(name, 'current', target)
}

const serving = Effect.fnUntraced(function* (url: string, name: string, version: AppVersion) {
	return yield* pipe(
		HttpClient.get(url),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
		Effect.filterOrFail(
			release => release.name === name && release.version === version,
			() => AppError.make({message: `${name} ${version} is not serving yet`})
		),
		// A request is never cut short: a slow answer gets the whole window a restarted service gets, and only a refused or wrong one is asked for again.
		Effect.retry({
			schedule: Schedule.spaced('1 second'),
			while: error => Array.contains(['HttpClientError', 'SchemaError', 'AppError'], error._tag)
		}),
		Effect.timeout('30 seconds')
	)
})

const versionIn = Effect.fnUntraced(function* (directory: string) {
	const fs = yield* FileSystem.FileSystem
	return (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({version: AppVersion})))(
		yield* fs.readFileString((yield* Path.Path).join(directory, 'package.json'))
	)).version
})

// Waits for the linked release to answer as itself and records it as the last one that served.
export const confirmRelease = Effect.fnUntraced(function* (name: string, url: string) {
	const path = yield* Path.Path
	const linked = yield* (yield* FileSystem.FileSystem).readLink(path.join(yield* serviceDirectory(name), 'current'))
	yield* serving(url, name, yield* versionIn(linked))
	yield* linkRelease(name, 'serving', linked)
})

function startRelease(name: string, url: string, release: string) {
	return pipe(
		activateRelease(name, release),
		Effect.andThen(restartService(name)),
		Effect.andThen(confirmRelease(name, url))
	)
}

const releaseExists = Effect.fnUntraced(function* (release: string) {
	return Option.isSome(yield* Effect.option(versionIn(release)))
})

const describeRelease = Effect.fnUntraced(function* (name: string, release: string) {
	return Option.match(yield* Effect.option(versionIn(release)), {
		onNone: () => `${name} at ${release}`,
		onSome: version => `${name} ${version}`
	})
})

// Starts the release and proves it answers; one that does not is replaced by the recorded one, proven the same way.
const promoteRelease = Effect.fnUntraced(function* (
	name: string,
	url: string,
	target: string,
	recorded: Option.Option<string>
) {
	const promoted = yield* Effect.exit(startRelease(name, url, target))
	if (Exit.isSuccess(promoted)) return
	// The recorded release runs again on the data the new one may have migrated, so it is proven, not assumed.
	const restored = yield* pipe(
		recorded,
		Option.filter(release => release !== target),
		Option.match({
			onNone: () => Effect.succeed('No other release is recorded as serving; the service is down'),
			onSome: Effect.fnUntraced(function* (release) {
				// `current` moves only onto a release that is on disk, so the next run can still start the one that failed.
				if (!(yield* releaseExists(release))) {
					return `The release recorded as serving at ${release} is missing, so ${name} stays linked to ${yield* describeRelease(name, target)} and is down`
				}
				const exit = yield* Effect.exit(startRelease(name, url, release))
				const label = yield* describeRelease(name, release)
				return Exit.match(exit, {
					onFailure: cause =>
						`${label} did not start serving again either; the service is down: ${Cause.pretty(cause)}`,
					onSuccess: () => `${label} is serving again`
				})
			})
		})
	)
	return yield* AppError.make({
		cause: promoted.cause,
		message: `${yield* describeRelease(name, target)} did not start serving: ${Cause.pretty(promoted.cause)}. ${restored}`
	})
})

// A `current` that names a deleted release is replaced by the one recorded as serving; with neither on disk nothing moves.
const releaseToRun = Effect.fnUntraced(function* (name: string, current: string, recorded: Option.Option<string>) {
	if (yield* releaseExists(current)) return current
	function missing(rest: string) {
		return AppError.make({message: `The ${name} release at ${current} is missing, and ${rest}`})
	}
	return yield* Option.match(recorded, {
		onNone: () => missing('none is recorded as serving'),
		onSome: Effect.fnUntraced(function* (release) {
			if (yield* releaseExists(release)) return release
			return yield* missing(`so is the one recorded as serving at ${release}`)
		})
	})
})

// Never two processes: the service manager stops the old one before starting the new. Callers hold the lifecycle lock.
export const updateRelease = Effect.fnUntraced(function* (name: string, url: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* serviceDirectory(name)
	const releases = path.join(root, 'releases')
	const current = yield* fs.readLink(path.join(root, 'current'))
	const recorded = yield* Effect.option(fs.readLink(path.join(root, 'serving')))
	const linked = yield* releaseToRun(name, current, recorded)
	const running = yield* versionIn(linked)
	// An update killed after it linked a release, or after that release failed to start, leaves the service on another one or down; it is brought back before anything is downloaded.
	const restarted = linked !== current || Exit.isFailure(yield* Effect.exit(serving(url, name, running)))
	if (restarted) {
		yield* Effect.uninterruptible(promoteRelease(name, url, linked, recorded))
	} else {
		yield* linkRelease(name, 'serving', linked)
	}
	const latest = (yield* pipe(
		HttpClient.filterStatusOk(yield* HttpClient.HttpClient).get(`https://registry.npmjs.org/@deslop%2f${name}/latest`),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({version: AppVersion}))),
		Effect.timeout('15 seconds')
	)).version
	if (latest === running) {
		return Boolean.match(restarted, {
			onFalse: () => `${name} ${running} is current\n`,
			onTrue: () => `${name} ${running} was not serving; it is serving now\n`
		})
	}
	const npm = yield* updaterNpm
	const directory = path.join(releases, latest)
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
		promoteRelease(name, url, path.join(directory, 'node_modules', '@deslop', name), Option.some(linked))
	)
	// The release before the update stays, and never the one the unit runs or the one that last served.
	const kept = pipe(
		[
			linked,
			...(yield* Effect.forEach(['current', 'serving'], link => fs.readLink(path.join(root, link)), {concurrency: 1}))
		],
		Array.map(target => Array.headNonEmpty(String.split(path.relative(releases, target), path.sep))),
		Array.append(latest)
	)
	yield* pipe(
		yield* fs.readDirectory(releases),
		Array.difference(kept),
		Effect.forEach(entry => fs.remove(path.join(releases, entry), {recursive: true}), {concurrency: 1})
	)
	return `Updated ${name} from ${running} to ${latest}\n`
})
