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
