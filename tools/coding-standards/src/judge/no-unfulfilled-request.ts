import {Array} from 'effect'

import {changeQuestion} from '#lib/question.ts'

// #498's request, its feeds hunk, and its schedule hunk, which the yes example leaves out.
const REQUEST =
	"OPM finds chapters again: recent community feeds, read hourly\n\nThe sync now reads each community's recent-posts feed, which still answers, and runs every hour instead of every six, so a chapter is announced within the hour it is posted."
const FEEDS = [
	'=== apps/opm/src/services/chapters/service.ts',
	'@@ -18,6 +18,6 @@ const FEEDS = [',
	"-\t'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100',",
	"-\t'https://www.reddit.com/r/OPMFolk/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'",
	"+\t'https://www.reddit.com/r/OnePunchMan/new/.rss?limit=100',",
	"+\t'https://www.reddit.com/r/OPMFolk/new/.rss?limit=100'",
	' ]'
]
const SCHEDULE = [
	'@@ -354,7 +367,7 @@ export class Chapters extends Context.Service<',
	'-\t\t\t// Chapters come out weekly, so four rounds a day announce one within six hours.',
	'+\t\t\t// Announce in the discovering round, then wait an hour before reading both communities again.',
	' \t\t\tyield* Effect.forkScoped(',
	'@@ -363,7 +376,7 @@ export class Chapters extends Context.Service<',
	" \t\t\t\t\t\tEffect.withSpan('Chapters.sync')",
	' \t\t\t\t\t),',
	"-\t\t\t\t\tSchedule.spaced('6 hours')",
	"+\t\t\t\t\tSchedule.spaced('1 hour')"
]

export const noUnfulfilledRequest = changeQuestion(
	'change',
	'Does `change`, the whole diff of what `request` says it does, leave part of `request` undone: a behavior or contract `request` promises with no implementation in `change`, a caller or contract in `context` (lines outside the diff that declare or use the names `request` mentions) left inconsistent with what `change` now does, or work that `change` introduces in one place and undoes in another?',
	{
		message:
			'Finish what the request says: implement the missing part, bring the callers along, or narrow the request to what the change does.',
		no: {
			cases: [
				'A change whose hunks carry out each promise of the request, with callers in `context` that already agree with it',
				'A promise the request itself names as not done, not proven or left for another change',
				'A line of the request that states context, a reason or evidence rather than what the change does',
				'Tests, documentation or generated files that follow from the implementation'
			],
			example: {
				change: Array.join(
					['Changed files:', 'M apps/opm/src/services/chapters/service.ts', '', ...FEEDS, ...SCHEDULE],
					'\n'
				),
				context: '',
				request: REQUEST
			}
		},
		yes: {
			cases: [
				'A promised behavior, setting or schedule that no hunk changes',
				'A changed function, schema or name whose callers in `context` still use the old shape or meaning',
				'A hunk that adds what another hunk of the same change removes, or the reverse'
			],
			example: {
				change: Array.join(['Changed files:', 'M apps/opm/src/services/chapters/service.ts', '', ...FEEDS], '\n'),
				context: Array.join(
					[
						'`Chapters`, outside the change:',
						"apps/opm/src/services/chapters/service.ts:363: \t\t\t\t\tSchedule.spaced('6 hours')"
					],
					'\n'
				),
				request: REQUEST
			}
		}
	}
)
