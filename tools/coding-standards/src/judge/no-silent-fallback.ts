import {question} from '#lib/question.ts'

export const noSilentFallback = question(
	'code',
	'Does `code` hide a failure it can reach, a failed operation or parse, behind an ordinary result that callers cannot tell from valid data? A missing key read as empty, a parse of text `code` already matched as digits, and optional extras are not failures.',
	{
		message: 'Let the failure reach the caller, or mark the result so it is not mistaken for valid data.',
		no: {
			cases: [
				'Absence that is the normal answer, such as a missing key, an unmatched lookup or the only configured choice',
				'Initial state when nothing earlier exists, or a sentinel meaning nothing was selected, while the underlying read still fails loudly',
				'A parse whose failure validation or construction visible in `code` rules out, such as a digit-only capture or a decimal string from integer arithmetic',
				'A parsing helper whose validator its caller supplies: do not imagine callers that pass a permissive one',
				'Best-effort normalization that keeps an unrecognized input unchanged',
				'Probes whose negative answer is what they observe, and data `code` treats as optional',
				'Optional display enrichment that leaves the main value unchanged when it is missing or cannot be decoded',
				'A best-effort operation explicitly allowed to fail without changing the main answer; logging alone does not establish that contract',
				'A failure presented as a distinct failure, not ordinary successful data',
				'Bad examples inside source text used as test fixtures'
			],
			example: `
				function loadNotes() {
					return Effect.map(store.get('notes'), Option.getOrElse(() => []))
				}
			`
		},
		yes: {
			cases: [
				'A reachable operation failure returned as plausible ordinary data contrary to the visible caller contract, even when logged; static empty recovery and discarded-failure patterns belong to lint',
				'Replacing a missing or malformed required number or time with a plausible one, such as zero, the epoch or now',
				'Dropping the parts of a value that failed to parse and computing an apparently valid result from the rest',
				'Returning content known to be incomplete when the request that completes it fails'
			],
			example: `
				function loadNotes() {
					return pipe(
						store.get('notes'),
						Effect.map(Option.getOrElse(() => [])),
						Effect.orElseSucceed(() => [])
					)
				}
			`
		}
	}
)
