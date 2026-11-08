#!/usr/bin/env node

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Console, Effect, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import packageJson from '#package.json' with {type: 'json'}

import {examples, judge} from '#judge/service.ts'
import {signIn} from '#judge/session.ts'

const INSTRUCTIONS = `# Lint tactics

When \`vp run fix\` leaves a diagnostic, apply these before changing the design.

**Converge.** Let autofix handle mechanical rewrites; batch the remaining diagnostics. Use these examples when the corresponding diagnostic fires.

**Inline safely.** Preserve evaluation order and receiver binding:

\`\`\`diff
-const value = store.get(key)
-return value
+return store.get(key)
\`\`\`

**Order, not architecture.** A use-before-definition diagnostic needs the dependency moved, not a new module or a mutable placeholder:

\`\`\`diff
-export function total(amount: number) { return fee(amount) + amount }
 export function fee(amount: number) { return amount * 0.2 }
+export function total(amount: number) { return fee(amount) + amount }
\`\`\`

**Fix the cause.** If a diagnostic survives, inspect the applied diff and the rule's premise before changing the design. Delete a whole unused declaration, not just its header. Preserve resource lifetime.

**No camouflage.** No casts, wrappers, spreads, suppressions or file splits merely to pass. Use documented exceptions with their required reason. If the intended form is rejected, show it beside a genuinely invalid counterexample before changing policy.

**Judged rules.** A message ending in "Judged 0.87" is Jev's answer about that one function, component or test, read without the rest of the codebase. Fix what it names; when the judgement lacks context the code cannot carry, put \`// judge-ignore <rule> -- <reason>\` in the comment above it. \`deslop-coding-standards judge\` fills the verdicts before lint; without a sign-in it asks for one, which the agent approves with Auth's \`answer_request\`.
`

const urls = {
	auth: pipe(
		Flag.String('auth'),
		Flag.withDescription('Deslop Auth origin'),
		Flag.withDefault('https://auth.mp281x.xyz')
	),
	gateway: pipe(
		Flag.String('gateway'),
		Flag.withDescription('Deslop Gateway origin, which spends your own OpenRouter key'),
		Flag.withDefault('https://gateway.mp281x.xyz')
	)
}

const cli = pipe(
	Command.make('deslop-coding-standards', {}, () => Console.log(INSTRUCTIONS)),
	Command.withDescription('Lint tactics for a diagnostic `vp run fix` leaves, and the judge that fills judged rules.'),
	Command.withSubcommands([
		pipe(
			Command.make(
				'judge',
				{
					...urls,
					all: pipe(
						Flag.Boolean('all'),
						Flag.withDescription('Judge every unit of the checkout, not only those changed since --base'),
						Flag.withDefault(false)
					),
					base: pipe(
						Flag.String('base'),
						Flag.withDescription('The branch the change started from; units unchanged since it stay unjudged'),
						Flag.withDefault('origin/HEAD')
					),
					examples: pipe(
						Flag.Boolean('examples'),
						Flag.withDescription('Ask each question about its own examples instead of judging the checkout'),
						Flag.withDefault(false)
					),
					ignore: pipe(
						Flag.String('ignore'),
						Flag.withDescription('A glob of tracked files to leave unjudged, as lint ignores them'),
						Flag.atLeast(0)
					)
				},
				Effect.fnUntraced(function* (input) {
					if (input.examples) return yield* examples(input)
					return yield* judge(input, input.ignore, input)
				})
			),
			Command.withDescription(
				'Judge each function, component and test case changed since --base that no cached verdict covers'
			)
		),
		pipe(
			Command.make('sign-in', urls, signIn),
			Command.withDescription('Sign the judge in to Gateway once per machine')
		)
	]),
	Command.run({version: packageJson.version})
)

NodeRuntime.runMain(Effect.provide(cli, [NodeServices.layer, NodeHttpClient.layerNodeHttp, NodeCrypto.layer]))
