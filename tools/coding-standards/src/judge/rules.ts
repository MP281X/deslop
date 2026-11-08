import {noBarAction} from '#rules/no-bar-action.ts'
import {noControlForWrongJob} from '#rules/no-control-for-wrong-job.ts'
import {noDetachedActionError} from '#rules/no-detached-action-error.ts'
import {noHeroFailure} from '#rules/no-hero-failure.ts'
import {noInternalsTest} from '#rules/no-internals-test.ts'
import {noLibraryTest} from '#rules/no-library-test.ts'
import {noMultiBehaviorTest} from '#rules/no-multi-behavior-test.ts'
import {noRepeatedSearch} from '#rules/no-repeated-search.ts'
import {noRepeatedTextAction} from '#rules/no-repeated-text-action.ts'
import {noRestatingComment} from '#rules/no-restating-comment.ts'
import {noSelfFetchingComponent} from '#rules/no-self-fetching-component.ts'
import {noStaleComment} from '#rules/no-stale-comment.ts'
import {noTitleMismatchTest} from '#rules/no-title-mismatch-test.ts'
import {noUnmountedChrome} from '#rules/no-unmounted-chrome.ts'

// Rules Jev judges one unit at a time: `lint.ts` registers them like any rule, and `judge` asks their questions before lint reads the answers.
export const JUDGED_RULES = {
	'no-bar-action': noBarAction,
	'no-control-for-wrong-job': noControlForWrongJob,
	'no-detached-action-error': noDetachedActionError,
	'no-hero-failure': noHeroFailure,
	'no-internals-test': noInternalsTest,
	'no-library-test': noLibraryTest,
	'no-multi-behavior-test': noMultiBehaviorTest,
	'no-repeated-search': noRepeatedSearch,
	'no-repeated-text-action': noRepeatedTextAction,
	'no-restating-comment': noRestatingComment,
	'no-self-fetching-component': noSelfFetchingComponent,
	'no-stale-comment': noStaleComment,
	'no-title-mismatch-test': noTitleMismatchTest,
	'no-unmounted-chrome': noUnmountedChrome
}
