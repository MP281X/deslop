import {Array} from 'effect'

import {changeQuestion} from '#lib/question.ts'

// The request of #498, and the file of it that does what it says, shared by both examples.
const REQUEST =
	"OPM finds chapters again: recent community feeds, read hourly\n\nOPM's chapter sync has failed since 11 November: Reddit answers the two search feeds it read with 403. The sync now reads each community's recent-posts feed, which still answers, and runs every hour instead of every six."
const FEEDS = [
	'=== apps/opm/src/services/chapters/service.ts',
	"@@ -18,6 +18,6 @@ import {ChaptersError, CubariSeries, DeadLink, Post, PushTickets, Series} from '#services/chapters/schema.ts'",
	"-// Reddit's JSON answers 403 to servers even through the proxy; its Atom search feed answers.",
	'+// Anonymous search and JSON are refused. Recent-post Atom still answers; a release can appear on either subreddit only.',
	' const FEEDS = [',
	"-\t'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100',",
	"-\t'https://www.reddit.com/r/OPMFolk/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'",
	"+\t'https://www.reddit.com/r/OnePunchMan/new/.rss?limit=100',",
	"+\t'https://www.reddit.com/r/OPMFolk/new/.rss?limit=100'",
	' ]'
]

export const noUnrelatedEdit = changeQuestion(
	'change',
	'Does a hunk of `change`, the whole diff of what `request` says it does, change behavior, policy, a dependency or a contract that `request` neither asks for nor needs in order to do or prove it, so reverting that hunk would leave every promise of `request` intact? `context` lists lines outside the diff that declare or use the names `request` mentions.',
	{
		message:
			'Revert the unrelated hunk, or move it to its own change; if the request needs it, say why in the request (the pull request body, or the commit message).',
		no: {
			cases: [
				'Hunks that do what the request says, or a step it needs: a renamed caller, a test, a fixture, documentation, a lockfile or generated file that follows from it',
				'A fix the request names, however far its file sits from the rest',
				'A hunk the request lists as a deliberate side change'
			],
			example: {
				change: Array.join(['Changed files:', 'M apps/opm/src/services/chapters/service.ts', '', ...FEEDS], '\n'),
				context: '',
				request: REQUEST
			}
		},
		yes: {
			cases: [
				'A behavior change in another feature, service or app the request never mentions',
				'A dependency, setting or contract changed beside the requested work with no line of the request needing it',
				'A refactor or restyle of code the requested work does not touch'
			],
			example: {
				change: Array.join(
					[
						'Changed files:',
						'M apps/deploy/src/services/fleet/service.ts',
						'M apps/opm/src/services/chapters/service.ts',
						'',
						'=== apps/deploy/src/services/fleet/service.ts',
						'@@ -88,7 +88,7 @@ export class Fleet extends Context.Service<',
						' \t\t\t\t\t\t\treturn {',
						'-\t\t\t\t\t\t\t\tcpuModel: saved?.cpuModel,',
						'+\t\t\t\t\t\t\t\t...Record.getSomes({cpuModel: Option.fromUndefinedOr(saved?.cpuModel)}),',
						" \t\t\t\t\t\t\t\terror: saved?.error ?? 'Waiting for worker',",
						...FEEDS
					],
					'\n'
				),
				context: '',
				request: REQUEST
			}
		}
	}
)
