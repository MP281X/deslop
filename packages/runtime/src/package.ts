import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, FileSystem, Layer, Path, Schema, pipe} from 'effect'

import {Argument, Command} from 'effect/cli'
import {Digest} from 'effect/crypto'
import {Hex} from 'effect/encoding'
import {HttpClient} from 'effect/http'

import {AppError, PackageMetadata} from '#cli/schema.ts'
import {execute} from '#cli/service.ts'

const preparePackage = Effect.fnUntraced(function* (app: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackageMetadata))(
		yield* fs.readFileString('package.json')
	)
	if (manifest.name !== `@deslop/${app}`) {
		return yield* AppError.make({message: 'Run app packaging from its own directory'})
	}
	yield* fs.remove('release', {force: true, recursive: true})
	yield* fs.makeDirectory('release')
	yield* fs.copy('dist', 'release/dist')
	if (yield* fs.exists('bin')) yield* fs.copy('bin', 'release/bin')
	if (yield* fs.exists('README.md')) yield* fs.copyFile('README.md', 'release/README.md')
	// Artifact metadata, not the workspace/Expo manifest: the server has already bundled every JS dependency.
	yield* fs.writeFileString(
		path.join('release', 'package.json'),
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
			...manifest,
			cpu: ['x64'],
			files: ['bin', 'dist'],
			main: './dist/server.js',
			os: ['linux'],
			publishConfig: {access: 'public'},
			type: 'module'
		})
	)
})

const build = Command.make(
	'app-package',
	{app: Argument.String('app')},
	Effect.fnUntraced(
		function* (input) {
			if (input.app !== 'stash' && input.app !== 'deploy') return
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const digest = yield* Digest.Digest
			const out = path.resolve('bin')
			yield* fs.makeDirectory(out, {recursive: true})
			const temporary = yield* fs.makeTempDirectoryScoped()
			const fetch = Effect.fnUntraced(function* (url: string, sha: string, name: string) {
				const file = path.join(temporary, name)
				const bytes = new Uint8Array(yield* (yield* client.get(url)).arrayBuffer)
				if (Hex.encode(yield* digest.digest(Digest.sha256, bytes)) !== sha) {
					return yield* AppError.make({message: `Checksum mismatch for ${name}`})
				}
				yield* fs.writeFile(file, bytes)
				return file
			})
			if (input.app === 'deploy') {
				const archive = yield* fetch(
					'https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_amd64.tar.gz',
					'727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b',
					'caddy.tar.gz'
				)
				yield* execute('tar', ['-xzf', archive, '-C', out, 'caddy', 'LICENSE'])
				yield* fs.chmod(path.join(out, 'caddy'), 0o755)
				yield* fs.writeFileString(
					path.join(out, 'SOURCES.txt'),
					'Caddy 2.11.7, Apache-2.0: https://github.com/caddyserver/caddy/tree/v2.11.7\nBinary: https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_amd64.tar.gz\n'
				)
				return
			}
			const archive = yield* fetch(
				'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-01-12-49/ffmpeg-n9.0.2-42-gd7643a0fe3-linux64-gpl-9.0.tar.xz',
				'11570b7bb1436ff432c91202ae0e7ea4be65359fd06650e18935c1ee9d005bf6',
				'ffmpeg.tar.xz'
			)
			const prefix = 'ffmpeg-n9.0.2-42-gd7643a0fe3-linux64-gpl-9.0'
			yield* execute('tar', [
				'-xJf',
				archive,
				'-C',
				out,
				'--strip-components=2',
				`${prefix}/bin/ffmpeg`,
				`${prefix}/bin/ffprobe`
			])
			yield* execute('tar', ['-xJf', archive, '-C', out, '--strip-components=1', `${prefix}/LICENSE.txt`])
			yield* fs.copyFile(
				yield* fetch(
					'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux',
					'767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795',
					'yt-dlp'
				),
				path.join(out, 'yt-dlp')
			)
			for (const tool of ['ffmpeg', 'ffprobe', 'yt-dlp']) yield* fs.chmod(path.join(out, tool), 0o755)
			yield* fs.copyFile(
				yield* fetch(
					'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/THIRD_PARTY_LICENSES.txt',
					'472aefe951c7db35e1657c1d13fd337140511ed6f2b329205105ad441c5a02b7',
					'yt-dlp-LICENSES.txt'
				),
				path.join(out, 'yt-dlp-LICENSES.txt')
			)
			yield* fs.writeFileString(
				path.join(out, 'SOURCES.txt'),
				'FFmpeg 9.0.2 GPL build and dependency/build recipes: https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-11-01-12-49\nFFmpeg source revision: https://github.com/FFmpeg/FFmpeg/tree/d7643a0fe3\nThe build recipes identify/download the component sources; retain the accompanying GPL license and source access when redistributing.\nyt-dlp 2026.10.26 PyInstaller build and source: https://github.com/yt-dlp/yt-dlp/tree/2026.10.26\nBundled Python/dependency license texts: yt-dlp-LICENSES.txt\n'
			)
		},
		(effect, input) => Effect.andThen(effect, preparePackage(input.app))
	)
)

NodeRuntime.runMain(
	pipe(
		Command.run(build, {version: '0.1.0'}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- Native artifact preparation is a release CLI entry point.
		Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer))
	)
)
