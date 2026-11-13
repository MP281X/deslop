import {changeQuestion} from '#lib/question.ts'

export const noUnrelatedEdit = changeQuestion(
	'scope',
	'Does `edit`, a hunk of the change to `file`, change behavior, policy, a dependency or a contract that `request`, what the change says it does, neither asks for nor needs in order to do or prove it, so reverting the hunk would leave every promise of `request` intact?',
	{
		message:
			'Revert the hunk, or move it to its own change; if the request needs it, say why in the request (the pull request body, or the commit message).',
		no: {
			cases: [
				'A hunk that does what the request says, or a step it needs: a renamed caller, a test, a fixture, documentation, a lockfile or generated file that follows from it',
				'A fix the request names, however far its file sits from the rest',
				'A hunk the request lists as a deliberate side change'
			],
			example: {
				edit: `
					@@ import {ChaptersError, CubariSeries, DeadLink, Post, PushTickets, Series} from '#services/chapters/schema.ts'
					-// Reddit's JSON answers 403 to servers even through the proxy; its Atom search feed answers.
					+// Anonymous search and JSON are refused. Recent-post Atom still answers; a release can appear on either subreddit only.
					 const FEEDS = [
					-	'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100',
					-	'https://www.reddit.com/r/OPMFolk/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'
					+	'https://www.reddit.com/r/OnePunchMan/new/.rss?limit=100',
					+	'https://www.reddit.com/r/OPMFolk/new/.rss?limit=100'
					 ]
				`,
				file: 'apps/opm/src/services/chapters/service.ts',
				request: `
					OPM finds chapters again: recent community feeds, read hourly

					OPM's chapter sync has failed since 11 November: Reddit answers the two search feeds it read with 403. The sync now reads each community's recent-posts feed, which still answers, and runs every hour instead of every six.
				`
			}
		},
		yes: {
			cases: [
				'A behavior change in another feature, service or app the request never mentions',
				'A dependency, setting or contract changed beside the requested work with no line of the request needing it',
				'A refactor or restyle of code the requested work does not touch'
			],
			example: {
				edit: `
					@@ export class Fleet extends Context.Service<
					 							return {
					-								cpuModel: saved?.cpuModel,
					+								...Record.getSomes({cpuModel: Option.fromUndefinedOr(saved?.cpuModel)}),
					 								error: saved?.error ?? 'Waiting for worker',
				`,
				file: 'apps/deploy/src/services/fleet/service.ts',
				request: `
					OPM finds chapters again: recent community feeds, read hourly

					OPM's chapter sync has failed since 11 November: Reddit answers the two search feeds it read with 403. The sync now reads each community's recent-posts feed, which still answers, and runs every hour instead of every six.
				`
			}
		}
	}
)
