import {noContradictedPromise} from '#judge/no-contradicted-promise.ts'
import {noImpossibleState} from '#judge/no-impossible-state.ts'
import {noInternalsTest} from '#judge/no-internals-test.ts'
import {noSilentFallback} from '#judge/no-silent-fallback.ts'
import {noTautologicalExpectation} from '#judge/no-tautological-expectation.ts'
import {noUnrelatedJobs} from '#judge/no-unrelated-jobs.ts'
import {noViewStateInMemory} from '#judge/no-view-state-in-memory.ts'

export const QUESTIONS = {
	'no-contradicted-promise': noContradictedPromise,
	'no-impossible-state': noImpossibleState,
	'no-internals-test': noInternalsTest,
	'no-silent-fallback': noSilentFallback,
	'no-tautological-expectation': noTautologicalExpectation,
	'no-unrelated-jobs': noUnrelatedJobs,
	'no-view-state-in-memory': noViewStateInMemory
}
