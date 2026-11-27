// oxlint-disable-next-line effecttsgo/node-builtin-import -- Expo identifies bundled assets by MD5, which Web Crypto does not provide.
import {createHash, randomUUID} from 'node:crypto'

import {DateTime, Effect, FileSystem, Option, Path, Schema} from 'effect'

import {Mime} from 'effect/http'

export const IPHONE_EXPORT_DIRECTORY = 'dist/iphone'

const Asset = Schema.Struct({
	contentType: Schema.String,
	fileExtension: Schema.String,
	hash: Schema.String,
	key: Schema.String,
	path: Schema.String
})

export const IPhoneExport = Schema.fromJsonString(
	Schema.Struct({
		assets: Schema.Array(Asset),
		createdAt: Schema.String,
		extra: Schema.Struct({expoClient: Schema.Record(Schema.String, Schema.Unknown)}),
		id: Schema.String,
		launchAsset: Asset,
		runtimeVersion: Schema.NonEmptyString
	})
)

const ExpoExport = Schema.fromJsonString(
	Schema.Struct({
		fileMetadata: Schema.Struct({
			ios: Schema.Struct({
				assets: Schema.Array(Schema.Struct({ext: Schema.String, path: Schema.String})),
				bundle: Schema.String
			})
		})
	})
)

const RuntimeVersion = Schema.fromJsonString(
	Schema.Struct({runtimeVersion: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u))})
)

// Turn Expo's export and CLI output into a manifest once at build time, not once per phone.
export const writeIPhoneExport = Effect.fnUntraced(function* (resolvedRuntime: string, publicConfig: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const {runtimeVersion} = yield* Schema.decodeEffect(RuntimeVersion)(resolvedRuntime)
	const expoClient = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
		publicConfig
	)
	const {
		fileMetadata: {ios}
	} = yield* Schema.decodeEffect(ExpoExport)(
		yield* fs.readFileString(path.join(IPHONE_EXPORT_DIRECTORY, 'metadata.json'))
	)

	const asset = Effect.fnUntraced(function* (relative: string, extension: string, contentType: string) {
		const bytes = yield* fs.readFile(path.join(IPHONE_EXPORT_DIRECTORY, relative))
		return {
			contentType,
			fileExtension: `.${extension}`,
			hash: createHash('sha256').update(bytes).digest('base64url'),
			key: createHash('md5').update(bytes).digest('hex'),
			path: relative
		}
	})

	const manifest = {
		assets: yield* Effect.forEach(ios.assets, entry =>
			asset(entry.path, entry.ext, Option.getOrElse(Mime.getType(entry.ext), () => 'application/octet-stream'))
		),
		createdAt: DateTime.formatIso(yield* DateTime.now),
		extra: {expoClient},
		id: randomUUID(),
		launchAsset: yield* asset(ios.bundle, 'bundle', 'application/javascript'),
		runtimeVersion
	}
	yield* fs.writeFileString(
		path.join(IPHONE_EXPORT_DIRECTORY, 'update.json'),
		yield* Schema.encodeEffect(IPhoneExport)(manifest)
	)
})
