import {Array, Boolean, Duration, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import type {Metadata, Comment} from '#services/media/schema.ts'

const BLOCKED =
	/not a bot|requir(?:es|ing) login|login required|CONNECT tunnel failed|unable to connect to proxy|tunnel connection failed|ProxyError|HTTP Error (?:403|429|5\d\d)|Requested format is not available|timed out/iu

const byStanding = pipe(
	Order.flip(Order.Boolean),
	Order.mapInput((comment: Comment) => Option.getOrElse(comment.is_pinned, () => false)),
	Order.combine(
		Order.mapInput(Order.flip(Order.Number), (comment: Comment) => Option.getOrElse(comment.like_count, () => 0))
	)
)

function commentLine(comment: Comment) {
	return Array.join(
		[
			`**${Option.getOrElse(comment.author, () => 'Someone')}**`,
			pipe(
				comment.author_is_uploader,
				Option.getOrElse(() => false),
				Boolean.match({onFalse: () => '', onTrue: () => ' (the uploader)'})
			),
			pipe(
				comment.is_pinned,
				Option.getOrElse(() => false),
				Boolean.match({onFalse: () => '', onTrue: () => ', pinned'})
			),
			Option.match(comment.like_count, {onNone: () => '', onSome: likes => `, ${likes} likes`}),
			`: ${String.trim(comment.text)}`
		],
		''
	)
}

export function captionTracks(media: Metadata) {
	const automatic = Record.keys(Option.getOrElse(media.automatic_captions, () => ({})))
	const original = Option.orElse(media.language, () =>
		pipe(automatic, Array.findFirst(String.endsWith('-orig')), Option.map(String.replace(/-orig$/u, '')))
	)
	const base = Option.map(original, value => Array.headNonEmpty(String.split(value, '-')))
	function preferred(language: string) {
		const spoken = String.replace(/-orig$/u, '')(language)
		return (
			String.endsWith('-orig')(language) ||
			Option.exists(
				original,
				languageOfSource =>
					spoken === languageOfSource || Option.contains(base, Array.headNonEmpty(String.split(spoken, '-')))
			)
		)
	}
	return pipe(
		[
			...Array.map(Record.keys(Option.getOrElse(media.subtitles, () => ({}))), language => ({
				authored: true,
				language
			})),
			...Array.map(automatic, language => ({authored: false, language}))
		],
		Array.filter(
			track =>
				track.language !== 'live_chat' &&
				(track.authored || Option.isNone(original) || preferred(track.language)) &&
				Array.isReadonlyArrayNonEmpty(
					pipe(
						track.authored,
						Boolean.match({onFalse: () => media.automatic_captions, onTrue: () => media.subtitles}),
						Option.flatMap(tracks => Record.get(tracks, track.language)),
						Option.getOrElse(Array.empty)
					)
				)
		),
		Array.sort(
			Order.mapInput(Order.Number, (track: {authored: boolean; language: string}) => {
				if (preferred(track.language) && track.authored) return 0
				if (preferred(track.language)) return 1
				if (track.authored) return 2
				return 3
			})
		)
	)
}

// yt-dlp's stderr when the residential exit is offline, flagged or throttled, so another exit may answer.
export function isBlocked(stderr: string) {
	return Option.isSome(String.match(BLOCKED)(stderr))
}

export function clock(seconds: Duration.Duration) {
	const parts = Duration.parts(seconds)
	return `${String.padStart(2, '0')(`${(parts.days * 24 + parts.hours) * 60 + parts.minutes}`)}:${String.padStart(2, '0')(`${parts.seconds}`)}`
}

export function mediaMarkdown(media: Metadata, link: string) {
	const details = pipe(
		[
			media.uploader,
			Option.map(media.upload_date, String.replace(/^(\d{4})(\d{2})(\d{2})$/u, '$1-$2-$3')),
			Option.map(media.duration, clock)
		],
		Array.getSomes,
		Array.filter(String.isNonEmpty)
	)
	return Array.join(
		Array.getSomes([
			Option.some(`# ${media.title}\n\n${Array.join(details, ', ')}\n${link}`),
			pipe(
				media.description,
				Option.filter(String.isNonEmpty),
				Option.map(description => `## Description\n\n${description}`)
			),
			Option.map(
				media.chapters,
				chapters =>
					`## Chapters\n\n${pipe(
						chapters,
						Array.map(chapter => `- [${clock(chapter.start_time)}] ${chapter.title}`),
						Array.join('\n')
					)}`
			),
			pipe(
				media.comments,
				Option.map(Array.filter(comment => Option.getOrElse(comment.parent, () => 'root') === 'root')),
				Option.filter(comments => Array.isReadonlyArrayNonEmpty(comments)),
				Option.map(
					comments =>
						`## Top comments\n\n${pipe(comments, Array.sort(byStanding), Array.take(40), Array.map(commentLine), Array.join('\n\n'))}`
				)
			)
		]),
		'\n\n'
	)
}

export function captionTranscript(input: {authored: boolean; vtt: string}) {
	const cues = pipe(
		input.vtt,
		String.replaceAll(/\r\n?/gu, '\n'),
		String.split('\n\n'),
		Array.flatMap(block => {
			const lines = String.split(block, '\n')
			return pipe(
				Array.findFirstIndex(lines, String.includes('-->')),
				Option.map(index => {
					const times = pipe(
						lines,
						Array.getUnsafe(index),
						String.split(' --> '),
						Array.map(time =>
							pipe(
								time,
								String.split(' '),
								Array.headNonEmpty,
								String.split(':'),
								Array.map(Number.parse),
								Option.all,
								Option.map(parts => Array.reduce(parts, 0, (total, part) => total * 60 + part)),
								Option.filter(Schema.is(Schema.Finite)),
								Option.map(Duration.seconds)
							)
						)
					)
					return pipe(
						lines,
						Array.drop(index + 1),
						Array.map(line => ({
							end: Array.lastNonEmpty(times),
							start: Array.headNonEmpty(times),
							text: pipe(
								line,
								String.replaceAll(/<[^>]+>/gu, ''),
								String.replaceAll('&nbsp;', ' '),
								String.replaceAll('&lt;', '<'),
								String.replaceAll('&gt;', '>'),
								String.replaceAll('&amp;', '&'),
								String.trim
							)
						}))
					)
				}),
				Option.getOrElse(Array.empty)
			)
		}),
		Array.filter(cue => String.isNonEmpty(cue.text))
	)
	// Rolling automatic captions repeat each line in the next cue.
	return pipe(
		cues,
		Array.filter((cue, index) =>
			pipe(
				cues,
				Array.get(index - 1),
				Option.match({
					onNone: () => true,
					onSome: previous =>
						input.authored ||
						previous.text !== cue.text ||
						pipe(
							Option.all([previous.end, cue.start]),
							Option.map(times => Duration.isLessThan(times[0], times[1])),
							Option.getOrElse(() => true)
						)
				})
			)
		),
		Array.map(
			cue =>
				`[${Option.match(Option.all([cue.start, cue.end]), {onNone: () => '—', onSome: times => clock(times[0])})}] ${cue.text}\n`
		),
		Array.join('')
	)
}

const spoken = String.replace(/^\[[^\]]+\] /u, '')

function wordsOf(text: string) {
	return pipe(text, String.toLowerCase, String.split(/[^\p{L}\p{N}']+/u), Array.filter(String.isNonEmpty))
}

// Transcription can turn music into looping or invented words, so only a talking pace of 40 words a minute counts as speech.
export function speechOnly(transcript: string) {
	const lines = pipe(
		String.split(transcript, '\n'),
		Array.filter(String.isNonEmpty),
		Array.dedupeAdjacentWith((left, right) => spoken(left) === spoken(right)),
		Array.filter(line => {
			const words = wordsOf(spoken(line))
			return Array.isReadonlyArrayNonEmpty(words) && Array.dedupe(words).length * 3 > words.length
		})
	)
	const words = Array.flatMap(lines, line => wordsOf(spoken(line)))
	const seconds = pipe(
		Array.last(lines),
		Option.flatMap(String.match(/^\[(\d+):(\d+)\]/u)),
		Option.map(match => [match[1] ?? '0', match[2] ?? '0'] as const),
		Option.map(parts =>
			Array.reduce(Array.getSomes(Array.map(parts, Number.parse)), 0, (total, part) => total * 60 + part)
		),
		Option.getOrElse(() => 0)
	)
	if (words.length < 8 || words.length * 60 < 40 * Number.max(seconds, 15)) return Option.none()
	return Option.some(
		pipe(
			lines,
			Array.map(line => `${line}\n`),
			Array.join('')
		)
	)
}
