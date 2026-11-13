import {execPath} from 'node:process'

import {Array, Config, Effect, FileSystem, Option, Path, Schema, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {AppError, executeProcess} from '#server/process.ts'
import {restartService} from '#server/services.ts'
import {AppVersion} from '#shared/schema.ts'

const serviceDirectory = Effect.fnUntraced(function* (name: string) {
	return (yield* Path.Path).join(yield* Config.String('HOME'), '.deslop', name)
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

// Never two processes: the service manager stops the old one before starting the new.
export const updateRelease = Effect.fnUntraced(function* (name: string) {
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
	const npm = path.resolve(path.dirname(execPath), '../lib/node_modules/npm/bin/npm-cli.js')
	if (!(yield* fs.exists(npm))) {
		return yield* AppError.make({message: 'This Node runtime does not include npm; install Node with Vite+'})
	}
	const directory = path.join(root, 'releases', latest)
	yield* Effect.timeout(
		executeProcess(execPath, [
			npm,
			'install',
			'--prefix',
			directory,
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--omit=dev',
			// npm's cached package metadata can predate the release /latest just named, which fails as "No matching version".
			'--prefer-online',
			'--registry=https://registry.npmjs.org',
			`@deslop/${name}@${latest}`
		]),
		'5 minutes'
	)
	const previous = yield* Effect.option(fs.readLink(path.join(root, 'current')))
	yield* activateRelease(name, path.join(directory, 'node_modules', '@deslop', name))
	yield* restartService(name)
	const kept = [latest, ...Option.toArray(Option.map(previous, link => path.basename(path.resolve(link, '../../..'))))]
	yield* pipe(
		yield* fs.readDirectory(path.join(root, 'releases')),
		Array.difference(kept),
		Effect.forEach(entry => fs.remove(path.join(root, 'releases', entry), {recursive: true}), {concurrency: 1})
	)
	return `Updated ${name} from ${running} to ${latest}\n`
})
