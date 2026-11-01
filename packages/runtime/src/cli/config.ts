import {Config, Effect, FileSystem, Path, Schema} from 'effect'

import {AppSettings} from '#cli/schema.ts'

export const configDirectory = Effect.fnUntraced(function* (name: string) {
	return (yield* Path.Path).join(yield* Config.String('HOME'), '.deslop', name)
})

export const savedSettings = Effect.fnUntraced(function* (name: string) {
	const fs = yield* FileSystem.FileSystem
	const file = (yield* Path.Path).join(yield* configDirectory(name), 'cli.json')
	if (!(yield* fs.exists(file))) return {}
	const saved = yield* Schema.decodeEffect(Schema.fromJsonString(AppSettings))(yield* fs.readFileString(file))
	return {APP_URL: saved.url, AUTH_URL: saved.auth, HOST: saved.host, OTEL_URL: saved.traces, PORT: saved.port}
})

export const saveSettings = Effect.fnUntraced(function* (name: string, config: AppSettings) {
	const fs = yield* FileSystem.FileSystem
	const directory = yield* configDirectory(name)
	const file = (yield* Path.Path).join(directory, 'cli.json')
	yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
	yield* fs.writeFileString(`${file}.next`, yield* Schema.encodeEffect(Schema.fromJsonString(AppSettings))(config), {
		mode: 0o600
	})
	yield* fs.rename(`${file}.next`, file)
})
