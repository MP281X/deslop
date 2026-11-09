import {question} from '#lib/question.ts'

export const noStringlyTyped = question(
	'code',
	'Does `code` pack its own structured data into a string and take it apart again, or type as plain `string` a value whose valid values `code` shows to be a fixed set?',
	{
		message: 'Type the values: a literal union for a closed set, an object or schema for structured data.',
		no: {
			cases: [
				'Text for display, logs, URLs, file paths, protocols or process output, including test doubles of them',
				'Credentials and tokens `code` issues to clients and parses when they come back, even when it owns both sides',
				'Source code given to a parser, compiler or lint test, including deliberately bad examples',
				'Open-ended outside names, tags, statuses or keys where `code` treats a few known values specially',
				'Grouping or lookup keys whose parts are never taken apart again',
				'Functions returning fixed literals, whose inferred type is already a literal union',
				'Values of imported types whose definitions `code` does not show'
			],
			example: `
				function announcements(flight: Flight) {
					return [\`Gate \${flight.gate}\`, \`Delayed \${flight.delay}\`]
				}
			`
		},
		yes: {
			cases: [
				'Joining fields `code` owns into one string, then splitting it to recover a field and decide on it',
				'A parameter or field `code` declares as string while every value it accepts is one of a few literals `code` lists'
			],
			example: `
				function announcements(flight: Flight) {
					const keys = [\`gate:\${flight.gate}\`, \`delay:\${flight.delay}\`]
					return Array.map(keys, key => {
						const [category, value] = key.split(':')
						return category === 'gate' ? \`Gate \${value}\` : \`Delayed \${value}\`
					})
				}
			`
		}
	}
)
