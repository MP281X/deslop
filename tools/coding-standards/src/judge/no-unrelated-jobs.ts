import {question} from '#lib/question.ts'

export const noUnrelatedJobs = question(
	'code',
	'Does `code` do two or more unrelated jobs that share no data, or pick between unrelated operations with a flag or mode argument?',
	{
		message: 'Split it into one function per job.',
		no: {
			cases: [
				'Steps of one job that pass values along',
				'A function whose job is to dispatch, such as a router, a reducer or a command handler',
				'Options that vary how one job is done, such as a format or a sort order',
				'A component rendering several parts of one view'
			],
			example: `
				function uploadDrafts(notes: Note[]) {
					return Effect.forEach(Array.filter(notes, note => note.draft), upload)
				}
			`
		},
		yes: {
			cases: [
				'Two parts of a function that use none of each other’s values and serve different purposes',
				'A boolean or mode parameter whose branches do different jobs rather than variations of one job'
			],
			example: `
				function sync(notes: Note[], prune: boolean) {
					if (prune) return removeOrphanImages(notes)
					return Effect.forEach(Array.filter(notes, note => note.draft), upload)
				}
			`
		}
	}
)
