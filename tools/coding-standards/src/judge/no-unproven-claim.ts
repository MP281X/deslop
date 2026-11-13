import {changeQuestion} from '#lib/question.ts'

export const noUnprovenClaim = changeQuestion(
	'claim',
	'Does `claim`, one line of `request`, what the change says it does, promise behavior a person or caller would observe that neither the evidence `request` gives nor `change`, the whole diff with its tests, shows working, and that `request` does not name as not proven?',
	{
		message:
			'Show it working where the claim says (a trace, a probe of the state it names, a test of that state), or add a not-proven line saying why it is not shown.',
		no: {
			cases: [
				'A claim a trace, probe, result or test in `request` or `change` shows working, in the state the claim names',
				'A line that itself says what is not proven and why, or a claim `request` names as not proven',
				'A line about code shape, a rename, removed code, documentation or tooling, with no behavior a person or caller observes',
				'A heading, a table header or a sentence of context'
			],
			example: {
				change: `
					Changed files:
					M apps/opm/src/services/chapters/service.ts

					=== apps/opm/src/services/chapters/service.ts
					@@ -18,6 +18,6 @@ const FEEDS = [
					-	'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100',
					-	'https://www.reddit.com/r/OPMFolk/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'
					+	'https://www.reddit.com/r/OnePunchMan/new/.rss?limit=100',
					+	'https://www.reddit.com/r/OPMFolk/new/.rss?limit=100'
					 ]
				`,
				claim: "The sync now reads each community's recent-posts feed, which still answers.",
				request: `
					OPM finds chapters again: recent community feeds, read hourly

					The sync now reads each community's recent-posts feed, which still answers.

					A real sync through the proxy from the worktree, trace 528e6afcdbb154d13d77230787cac4ab: both communities answered 200 and manga 243 was found again.

					- [ ] Not exercised: a new chapter arriving in production; manga 244 is expected around 18 November.
				`
			}
		},
		yes: {
			cases: [
				'A behavior claim whose state no trace, probe or test in `request` or `change` reaches, such as a first run, a failure, an absent value or another platform',
				'A claim supported only by passing tests of another state, lint or a screenshot of a different state',
				'An observation in `request` that contradicts the claim'
			],
			example: {
				change: `
					Changed files:
					M apps/deploy/src/services/fleet/service.ts

					=== apps/deploy/src/services/fleet/service.ts
					@@ -88,7 +88,7 @@ export class Fleet extends Context.Service<
					 							return {
					-								cpuModel: saved?.cpuModel,
					+								...Record.getSomes({cpuModel: Option.fromUndefinedOr(saved?.cpuModel)}),
					 								error: saved?.error ?? 'Waiting for worker',
				`,
				claim: "A worker with no history yet no longer breaks Deploy's page: the charts stay.",
				request: `
					Deploy: a worker with no history yet no longer breaks the page

					A worker with no history yet no longer breaks Deploy's page: the charts stay.

					Evidence: vp run test passes. Screenshot: Deploy's page with both workers sampled for an hour.
				`
			}
		}
	}
)
