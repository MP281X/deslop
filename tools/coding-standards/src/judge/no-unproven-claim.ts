import {changeQuestion} from '#lib/question.ts'

export const noUnprovenClaim = changeQuestion(
	'claim',
	'Does `claim`, one line of what the change says it does, promise behavior a person or caller would observe that `proof`, everything the change offers as evidence, neither shows working nor names as not proven?',
	{
		message:
			'Show it working where the claim says (a recording, a trace, a probe of the state it names), or add a not-proven line saying why it is not shown.',
		no: {
			cases: [
				'A claim a recording, trace, probe or result in `proof` shows working, in the state the claim names',
				'A line that itself says what is not proven and why',
				'A line about code shape, a rename, removed code, documentation or tooling, with no behavior a person or caller observes',
				'A heading, a table header or a sentence of context'
			],
			example: {
				claim: "The sync now reads each community's recent-posts feed, which still answers.",
				proof: `
					OPM finds chapters again: recent community feeds, read hourly

					The sync now reads each community's recent-posts feed, which still answers.

					A real sync through the proxy from the worktree, trace 528e6afcdbb154d13d77230787cac4ab: both communities answered 200 and manga 243 was found again.

					- [ ] Not exercised: a new chapter arriving in production; manga 244 is expected around 18 November.
				`
			}
		},
		yes: {
			cases: [
				'A behavior claim whose state no recording, trace or probe in `proof` reaches, such as a first run, a failure, an absent value or another platform',
				'A claim `proof` supports only with passing tests, lint or a screenshot of a different state',
				'An observation in `proof` that contradicts the claim'
			],
			example: {
				claim: "A worker with no history yet no longer breaks Deploy's page: the charts stay.",
				proof: `
					Deploy: a worker with no history yet no longer breaks the page

					A worker with no history yet no longer breaks Deploy's page: the charts stay.

					Evidence: vp run test passes. Screenshot: Deploy's page with both workers sampled for an hour.
				`
			}
		}
	}
)
