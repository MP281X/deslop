import {Array, Boolean, Duration, Number, Option, Order, Record, String, pipe} from 'effect'

import type {Metadata} from '#services/media/schema.ts'

const BLOCKED =
	/not a bot|requir(?:es|ing) login|login required|CONNECT tunnel failed|unable to connect to proxy|tunnel connection failed|ProxyError|HTTP Error (?:403|429|5\d\d)|Requested format is not available|timed out/iu

export function captionTracks(media: Metadata) {
	const automatic = Record.keys(media.automatic_captions ?? {})
	const original =
		media.language ??
		pipe(
			Array.findFirst(automatic, String.endsWith('-orig')),
			Option.map(String.replace(/-orig$/u, '')),
			Option.getOrUndefined
		)
	const base = Option.map(Option.fromUndefinedOr(original), value => Array.headNonEmpty(String.split(value, '-')))
	function preferred(language: string) {
		const spoken = String.replace(/-orig$/u, '')(language)
		return (
			String.endsWith('-orig')(language) ||
			(original !== undefined &&
				(spoken === original || Option.contains(base, Array.headNonEmpty(String.split(spoken, '-')))))
		)
	}
	return pipe(
		[
			...Array.map(Record.keys(media.subtitles ?? {}), language => ({authored: true, language})),
			...Array.map(automatic, language => ({authored: false, language}))
		],
		Array.filter(
			track =>
				track.language !== 'live_chat' &&
				(track.authored || original === undefined || preferred(track.language)) &&
				Array.isReadonlyArrayNonEmpty(
					Boolean.match(track.authored, {onFalse: () => media.automatic_captions, onTrue: () => media.subtitles})?.[
						track.language
					] ?? []
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

export function clock(seconds: number) {
	const parts = Duration.parts(Duration.seconds(seconds))
	return `${pipe(`${(parts.days * 24 + parts.hours) * 60 + parts.minutes}`, String.padStart(2, '0'))}:${pipe(`${parts.seconds}`, String.padStart(2, '0'))}`
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
					const times = Array.map(pipe(Array.getUnsafe(lines, index), String.split(' --> ')), time =>
						Array.reduce(
							pipe(
								time,
								String.split(' '),
								Array.headNonEmpty,
								String.split(':'),
								Array.map(Number.parse),
								Array.getSomes
							),
							0,
							(total, part) => total * 60 + part
						)
					)
					return Array.map(Array.drop(lines, index + 1), line => ({
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
				}),
				Option.getOrElse(Array.empty)
			)
		}),
		Array.filter(cue => String.isNonEmpty(cue.text))
	)
	// Rolling automatic captions repeat each line in the next cue.
	return Array.join(
		Array.map(
			Array.filter(cues, (cue, index) =>
				pipe(
					Array.get(cues, index - 1),
					Option.match({
						onNone: () => true,
						onSome: previous => input.authored || previous.text !== cue.text || previous.end < cue.start
					})
				)
			),
			cue => `[${clock(cue.start)}] ${cue.text}\n`
		),
		''
	)
}

const spoken = String.replace(/^\[[^\]]+\] /u, '')

function wordsOf(text: string) {
	return pipe(text, String.toLowerCase, String.split(/[^\p{L}\p{N}']+/u), Array.filter(String.isNonEmpty))
}

// Whisper hears music as looping or invented words, so only a talking pace of 40 words a minute counts as speech.
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
		Array.join(
			Array.map(lines, line => `${line}\n`),
			''
		)
	)
}
