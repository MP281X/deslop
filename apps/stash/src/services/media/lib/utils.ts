import {Array, Duration, Number, Option, String, pipe} from 'effect'

export function clock(seconds: number) {
	const parts = Duration.parts(Duration.seconds(seconds))
	return `${pipe(`${(parts.days * 24 + parts.hours) * 60 + parts.minutes}`, String.padStart(2, '0'))}:${pipe(`${parts.seconds}`, String.padStart(2, '0'))}`
}

export function captionTranscript(input: {authored: boolean; vtt: string}) {
	const cues = pipe(
		input.vtt,
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
							String.replace(/<[^>]+>/gu, ''),
							String.replace(/&nbsp;/gu, ' '),
							String.replace(/&lt;/gu, '<'),
							String.replace(/&gt;/gu, '>'),
							String.replace(/&amp;/gu, '&'),
							String.trim
						)
					}))
				}),
				Option.getOrElse(Array.empty)
			)
		}),
		Array.filter(cue => String.isNonEmpty(cue.text))
	)
	// Automatic rolling captions repeat a line in the cue that starts as the previous one ends; uploaded captions and
	// later repeats stay.
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

// Whisper hears music as words: it loops on "mmm" or repeats one line every two seconds, between invented phrases such as
// "Thank you for watching!". Repeated lines collapse and one-word loops go; what is left counts as speech only at a
// talking pace of at least 40 words a minute up to its last timestamp, which songs with a few hallucinated phrases miss.
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
	return words.length >= 8 && words.length * 60 >= 40 * Number.max(seconds, 15)
		? Option.some(
				Array.join(
					Array.map(lines, line => `${line}\n`),
					''
				)
			)
		: Option.none()
}

function spoken(line: string) {
	return String.replace(/^\[[^\]]+\] /u, '')(line)
}

function wordsOf(text: string) {
	return pipe(text, String.toLowerCase, String.split(/[^\p{L}\p{N}']+/u), Array.filter(String.isNonEmpty))
}
