import {execPath} from 'node:process'

import {
	Array,
	Boolean,
	ByteSize,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Match,
	Number,
	Option,
	Order,
	Path,
	Random,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Dns} from 'effect/net'
import type {PlatformError} from 'effect/PlatformError'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {ToolPath} from '@deslop/runtime/server/process'
import {dataDirectory} from '@deslop/runtime/server/store'

import {MediaError, MediaMetadata, Probe} from './contract.ts'
import type {MediaBudget} from './contract.ts'
import {LOCAL_ONLY, isBlocked, withoutProxy, ytDlpRun} from './media-text.ts'

import {publicAddress, sticky} from '#notes/content.ts'
import {NotesError} from '#notes/contract.ts'
import {isYouTube} from '#notes/shared.ts'

const NOTE_DEADLINE = Duration.hours(1)

const NOTE_BYTES = ByteSize.gibibytes(2)

function output(stream: Stream.Stream<Uint8Array, PlatformError>, command: string, limit: ByteSize.ByteSize) {
	return Stream.limitBytes<PlatformError | MediaError, never>(stream, limit, () =>
		Stream.fail(MediaError.make({message: `${command} wrote more than Stash reads.`, reason: 'Budget'}))
	)
}

function outgrown() {
	return MediaError.make({
		message: `The note's media work outgrew its ${ByteSize.format(NOTE_BYTES)}.`,
		reason: 'Budget'
	})
}

// Every media call of a note stops at the note's deadline, however its tools and requests divide the time.
export function withinDeadline(budget: MediaBudget) {
	return <A, R>(effect: Effect.Effect<A, MediaError, R>) =>
		Effect.flatMap(DateTime.now, now =>
			Effect.timeoutOrElse(effect, {
				duration: pipe(now, DateTime.distance(budget.deadline), Duration.max(Duration.zero)),
				orElse: () =>
					Effect.fail(MediaError.make({message: "The note's media work ran past its hour.", reason: 'Budget'}))
			})
		)
}

// When set, every read of a source exits through this proxy, so sites never see the server's address; `{session}` keeps one exit address per request.
export const sourceProxy = Config.option(Config.Redacted('STASH_PROXY'))

// The tools a note's media work runs: yt-dlp and ffmpeg inside the note's own budget, its frames, and its link inspected.
export class Media extends Context.Service<Media>()('@deslop/stash/media/server/Media', {
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const locate = yield* ToolPath
		const dns = yield* Dns.Dns
		// The media tools work in the app's own folder, emptied at start, so a run a crash cut short leaves nothing behind.
		const scratch = path.join(directory, 'media')
		yield* fs.remove(scratch, {force: true, recursive: true})
		yield* fs.makeDirectory(scratch, {mode: 0o700, recursive: true})
		const budgets = yield* Ref.make(0)

		// The bytes in the note's folder now; a file or folder a tool or another call removes while it is read counts as gone.
		const used = Effect.fnUntraced(function* (folder: string) {
			const names = yield* pipe(
				fs.readDirectory(folder, {recursive: true}),
				Effect.option,
				Effect.map(Option.getOrElse(Array.empty<string>))
			)
			const sizes = yield* Effect.forEach(
				names,
				name =>
					pipe(
						fs.stat(path.join(folder, name)),
						Effect.option,
						Effect.map(
							Option.match({
								onNone: () => ByteSize.bytes(0),
								onSome: found =>
									Boolean.match(found.type === 'File', {onFalse: () => ByteSize.bytes(0), onTrue: () => found.size})
							})
						)
					),
				{concurrency: 'unbounded'}
			)
			return Array.reduce(sizes, ByteSize.bytes(0), ByteSize.sum)
		})
		// The allowance is checked once a second while a tool runs and once more when it exits, not enforced as a quota: a tool can exceed it for up to a second, and what it leaves behind is found before its output is accepted.
		const overspent = Effect.fnUntraced(function* (folder: string) {
			while (!ByteSize.isGreaterThan(yield* used(folder), NOTE_BYTES)) yield* Effect.sleep('1 second')
			return yield* outgrown()
		})
		const withinAllowance = Effect.fnUntraced(function* (folder: string) {
			if (ByteSize.isGreaterThan(yield* used(folder), NOTE_BYTES)) return yield* outgrown()
		})
		const run = Effect.fn('Media.command')(function* (
			budget: MediaBudget,
			command: string,
			args: string[],
			options: {readonly output: ByteSize.ByteSize; readonly stdin: Option.Option<string>}
		) {
			yield* Effect.annotateCurrentSpan({command, 'command.arguments': args.length})
			yield* fs.makeDirectory(budget.directory, {mode: 0o700, recursive: true})
			const child = yield* ChildProcess.make(yield* locate(command), args, {
				forceKillAfter: Duration.seconds(5),
				stderr: 'pipe',
				stdin: Option.match(options.stdin, {
					onNone: Function.constant('ignore' as const),
					onSome: text => Stream.make(new TextEncoder().encode(text))
				}),
				stdout: 'pipe'
			})
			return yield* pipe(
				Effect.all(
					{
						exitCode: child.exitCode,
						stderr: pipe(output(child.stderr, command, ByteSize.mebibytes(1)), Stream.decodeText, Stream.mkString),
						stdout: Stream.mkUint8Array(output(child.stdout, command, options.output))
					},
					{concurrency: 'unbounded'}
				),
				Effect.raceFirst(overspent(budget.directory)),
				Effect.tap(() => withinAllowance(budget.directory)),
				Effect.timeoutOrElse({
					duration: pipe(
						Match.value(command),
						Match.when('yt-dlp', () => Duration.minutes(30)),
						Match.when('ffprobe', () => Duration.minutes(1)),
						Match.orElse(() => Duration.minutes(10))
					),
					orElse: () => Effect.fail(MediaError.make({message: `${command} exceeded its time limit`, reason: 'Budget'}))
				})
			)
		}, Effect.scoped)
		// Each call works in its own folder inside the note's.
		const workspace = Effect.fnUntraced(function* (budget: MediaBudget, prefix: string) {
			yield* fs.makeDirectory(budget.directory, {mode: 0o700, recursive: true})
			return yield* fs.makeTempDirectoryScoped({directory: budget.directory, prefix})
		})
		const ytDlpArgs = [
			'--js-runtimes',
			`node:${execPath}`,
			'--ffmpeg-location',
			yield* locate('ffmpeg'),
			'--no-progress',
			'--no-warnings',
			'--no-playlist'
		]
		const exit = yield* sourceProxy

		// yt-dlp fetches only a link the page reader would read itself; where it connects after that is up to it and the proxy.
		const publicLink = Effect.fnUntraced(function* (link: string) {
			yield* pipe(
				Effect.try({
					catch: cause => NotesError.make({cause, message: 'The media link is invalid.'}),
					try: () => new URL(link)
				}),
				Effect.flatMap(publicAddress),
				Effect.provideService(Dns.Dns, dns),
				Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp reads only public web links.'}))
			)
		})

		// A residential exit can be offline or flagged by the site, so a blocked run retries twice, each time from another exit address.
		const fetch = Effect.fnUntraced(function* (
			budget: MediaBudget,
			link: string,
			args: string[],
			limit: ByteSize.ByteSize = ByteSize.mebibytes(4)
		) {
			yield* publicLink(link)
			return yield* Effect.repeat(
				Effect.gen(function* () {
					const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
					const proxy = Option.map(exit, url => Redacted.value(sticky(url, session)))
					const command = ytDlpRun([...ytDlpArgs, ...args, link], proxy)
					const result = yield* run(budget, 'yt-dlp', command.args, {output: limit, stdin: command.stdin})
					return {
						...result,
						stderr: Option.match(proxy, {onNone: () => result.stderr, onSome: url => withoutProxy(result.stderr, url)})
					}
				}),
				{
					times: Boolean.match(Option.isSome(exit), {onFalse: Function.constant(0), onTrue: Function.constant(2)}),
					while: result => result.exitCode !== 0 && isBlocked(result.stderr)
				}
			)
		})

		function withProcesses<A, E>(
			effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path>
		) {
			return pipe(
				effect,
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path),
				Effect.mapError(cause =>
					pipe(
						cause,
						Option.liftPredicate(Schema.is(MediaError)),
						Option.getOrElse(() => MediaError.make({cause, message: 'Cannot extract the media'}))
					)
				)
			)
		}

		const probe = Effect.fnUntraced(function* (budget: MediaBudget, file: string) {
			const result = yield* run(
				budget,
				'ffprobe',
				['-v', 'error', ...LOCAL_ONLY, '-show_entries', 'format=duration:stream=index,codec_type', '-of', 'json', file],
				{output: ByteSize.mebibytes(4), stdin: Option.none()}
			)
			if (result.exitCode !== 0) {
				return yield* MediaError.make({message: `ffprobe cannot inspect the media: ${result.stderr}`})
			}
			return yield* Schema.decodeEffect(Schema.fromJsonString(Probe))(new TextDecoder().decode(result.stdout))
		})

		const lengthOf = Effect.fnUntraced(function* (budget: MediaBudget, file: string) {
			return Option.flatMap((yield* probe(budget, file)).format, format => format.duration)
		})

		const sample = Effect.fnUntraced(function* (budget: MediaBudget, video: string, work: string) {
			const length = yield* Effect.fromOption(yield* lengthOf(budget, video), () =>
				MediaError.make({message: 'The video duration is unknown; frames could not be sampled.'})
			)
			const seconds = Duration.toSeconds(length)
			// A still every 15 seconds, 12 to 48 of them, so a short clip shows its captions and a long talk its slides.
			const count = Number.max(12, Number.min(48, Math.ceil(seconds / 15)))
			const sampled = yield* run(
				budget,
				'ffmpeg',
				[
					'-v',
					'error',
					...LOCAL_ONLY,
					'-i',
					video,
					'-vf',
					`fps=${count}/${seconds},scale='min(1024,iw)':-2`,
					'-frames:v',
					`${count}`,
					'-q:v',
					'5',
					path.join(work, 'frame-%02d.jpg')
				],
				{output: ByteSize.mebibytes(4), stdin: Option.none()}
			)
			if (sampled.exitCode !== 0) {
				return yield* MediaError.make({message: `ffmpeg cannot sample the video: ${sampled.stderr}`})
			}
			return yield* pipe(
				yield* fs.readDirectory(work),
				Array.filter(String.startsWith('frame-')),
				Array.sort(Order.String),
				Effect.forEach(
					(file, index) =>
						Effect.map(fs.readFile(path.join(work, file)), bytes => ({
							bytes,
							seconds: Duration.times(length, index / count)
						})),
					{concurrency: 'unbounded'}
				)
			)
		})

		return {
			budget: Effect.withSpan(
				Effect.gen(function* () {
					const folder = path.join(scratch, `note-${yield* Ref.getAndUpdate(budgets, Number.increment)}`)
					yield* Effect.addFinalizer(() =>
						Effect.ignore(fs.remove(folder, {force: true, recursive: true}), {
							log: 'Warn',
							message: "A note's media folder stays until the next start"
						})
					)
					return {deadline: DateTime.addDuration(yield* DateTime.now, NOTE_DEADLINE), directory: folder}
				}),
				'Media.budget'
			),
			fetch,
			fileFrames: Effect.fn('Media.fileFrames')(
				function* (budget: MediaBudget, file: string) {
					return yield* sample(budget, file, yield* workspace(budget, 'deslop-media-'))
				},
				Effect.scoped,
				withProcesses,
				(effect, budget) => withinDeadline(budget)(effect)
			),
			frames: Effect.fn('Media.frames')(
				function* (budget: MediaBudget, link: string) {
					const work = yield* workspace(budget, 'deslop-media-')
					const download = yield* fetch(budget, link, [
						'-f',
						// YouTube offers no plain mp4 to a server, so the stills come from a video-only stream; 480p keeps slide text readable.
						'bv*[height<=480]/wv*/b',
						'--max-filesize',
						'500M',
						'-o',
						path.join(work, 'video.%(ext)s')
					])
					if (download.exitCode !== 0) {
						return yield* MediaError.make({message: `yt-dlp cannot download the video: ${download.stderr}`})
					}
					const video = path.join(
						work,
						yield* pipe(
							Array.findFirst(yield* fs.readDirectory(work), String.startsWith('video.')),
							Effect.fromOption,
							Effect.mapError(cause => MediaError.make({cause, message: 'yt-dlp downloaded no video'}))
						)
					)
					return yield* sample(budget, video, work)
				},
				Effect.scoped,
				withProcesses,
				(effect, budget) => withinDeadline(budget)(effect)
			),
			inspect: Effect.fn('Media.inspect')(
				function* (budget: MediaBudget, link: string, video: Option.Option<string>) {
					const inspect = Effect.fnUntraced(function* (url: string) {
						const dump = yield* fetch(
							budget,
							url,
							[
								'--dump-single-json',
								'--flat-playlist',
								'--skip-download',
								// Some extractors only expose subtitle metadata when subtitle extraction is requested.
								'--write-subs',
								'--write-auto-subs',
								'--simulate',
								// The top comments hold corrections, answers and pushback; only YouTube can cap how many load.
								...Boolean.match(isYouTube(link), {
									onFalse: () => [],
									onTrue: () => [
										'--write-comments',
										'--extractor-args',
										'youtube:comment_sort=top;max_comments=60,60,0,0'
									]
								})
							],
							// Sixty comments and every format and caption track of a long video fit.
							ByteSize.mebibytes(32)
						)
						if (dump.exitCode !== 0) {
							return yield* MediaError.make({
								message: `yt-dlp cannot read the video: ${String.replaceAll(/https?:\/\/\S+/gu, '<link>')(dump.stderr)}`
							})
						}
						const media = yield* Schema.decodeEffect(Schema.fromJsonString(MediaMetadata))(
							new TextDecoder().decode(dump.stdout)
						)
						if (Option.contains(media._type, 'playlist')) {
							return yield* MediaError.make({message: 'The link holds several videos.'})
						}
						return {media, url}
					})
					return yield* Effect.catch(inspect(link), error =>
						pipe(
							video,
							Option.filter(url => url !== link),
							Option.match({
								onNone: () => Effect.fail(error),
								onSome: url =>
									Effect.andThen(
										Effect.logWarning('The primary media link could not be inspected', error),
										inspect(url)
									)
							})
						)
					)
				},
				Effect.scoped,
				withProcesses,
				(effect, budget) => withinDeadline(budget)(effect)
			),
			// What the transcripts reuse: the tools the media work runs with.
			lengthOf,
			probe,
			run,
			withProcesses,
			workspace
		}
	})
}) {
	static readonly layer = (directory: string) => Layer.effect(this, this.make(directory))
}

export const layerMedia = Layer.unwrap(Effect.map(dataDirectory, Media.layer))
