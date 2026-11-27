import {Array, Effect, FileSystem, Option, Path, Result, Schema, String} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {IPHONE_EXPORT_DIRECTORY, IPhoneExport} from '#config/iphone-export.ts'
import {IPHONE_UPDATE_PATH} from '#config/iphone.ts'
import type {Auth} from '#server/auth.ts'
import {packageRoot} from '#server/package.ts'
import {failureOptions} from '#shared/auth.ts'

export const registerIPhoneUpdates = Effect.fnUntraced(function* (
	router: HttpRouter.HttpRouter,
	auth: Auth['Service'],
	origin: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = path.join(packageRoot, IPHONE_EXPORT_DIRECTORY)
	const manifestFile = path.join(directory, 'update.json')
	if (!(yield* fs.exists(manifestFile))) return
	const {assets, launchAsset, ...manifest} = yield* Schema.decodeEffect(IPhoneExport)(
		yield* fs.readFileString(manifestFile)
	)
	const assetsPath = `${IPHONE_UPDATE_PATH}/assets`
	const headers = {'cache-control': 'no-store', 'expo-protocol-version': '1', 'expo-sfv-version': '0'}

	// The downloader is a native caller like any other: Auth can identify its tailnet device without a sign-in.
	const authorized = <E, R>(
		serve: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
	) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			const account = yield* Effect.result(auth.account(request.headers))
			if (Result.isFailure(account)) return HttpServerResponse.empty(failureOptions(account.failure, 401))
			return yield* serve(request)
		})

	function manifestAsset(asset: typeof launchAsset) {
		return {
			contentType: asset.contentType,
			fileExtension: asset.fileExtension,
			hash: asset.hash,
			key: asset.key,
			url: new URL(`${assetsPath}/${asset.hash}`, origin).href
		}
	}
	const response = HttpServerResponse.jsonUnsafe(
		{...manifest, assets: Array.map(assets, manifestAsset), launchAsset: manifestAsset(launchAsset), metadata: {}},
		{contentType: 'application/expo+json', headers}
	)
	yield* router.add(
		'GET',
		IPHONE_UPDATE_PATH,
		authorized(request => {
			const requestHeaders = request.headers
			if (requestHeaders['expo-protocol-version'] !== '1' || requestHeaders['expo-platform'] !== 'ios') {
				return Effect.succeed(HttpServerResponse.empty({headers, status: 400}))
			}
			return Effect.succeed(
				requestHeaders['expo-runtime-version'] !== manifest.runtimeVersion ||
					String.toLowerCase(requestHeaders['expo-current-update-id'] ?? '') === manifest.id
					? HttpServerResponse.empty({headers, status: 204})
					: response
			)
		})
	)

	const exported = Array.prepend(assets, launchAsset)
	yield* router.add(
		'GET',
		`${assetsPath}/:hash`,
		authorized(() =>
			Effect.gen(function* () {
				const {hash} = yield* HttpRouter.params
				const asset = Array.findFirst(exported, entry => entry.hash === hash)
				if (Option.isNone(asset)) return HttpServerResponse.empty({status: 404})
				return yield* HttpServerResponse.file(path.join(directory, asset.value.path), {
					contentType: asset.value.contentType,
					headers: {'cache-control': 'private, max-age=31536000, immutable'}
				})
			})
		)
	)
})
