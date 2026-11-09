import {question} from '#lib/question.ts'

export const noRoundtrip = question(
	'code',
	'Does `code` encode a value and decode that same value back for its own computation, while the original is still at hand?',
	{
		message: 'Keep the original value instead of encoding it and decoding it back.',
		no: {
			cases: [
				'Text written for storage, a network request, a URL or display',
				'Encoding the current value for storage while decoding an older stored one in the same function',
				'A string key used only to group or look up, never parsed back',
				'Parsing text that came from outside `code`'
			],
			example: `
				function series(entries: Entry[]) {
					return Array.map(Record.values(Array.groupBy(entries, entry => \`\${entry.hour}\`)), group => ({
						count: group.length,
						hour: group[0].hour
					}))
				}
			`
		},
		yes: {
			cases: [
				'A number used as a group key and parsed back out of the key, while the grouped items still hold it',
				'Encoding a value as JSON, a joined string or an Option and decoding it again within the same computation'
			],
			example: `
				function series(entries: Entry[]) {
					return Array.map(Record.toEntries(Array.groupBy(entries, entry => \`\${entry.hour}\`)), group => ({
						count: group[1].length,
						hour: Number(group[0])
					}))
				}
			`
		}
	}
)
