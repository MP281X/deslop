import {Array, Record, pipe} from 'effect'

import {recommended} from '@typeonce/oxlint-plugin-effect-machine/recommended'
import type {OxlintConfig} from 'vite-plus/lint'
import {definePlugin} from 'vite-plus/lint/plugins'
import type {Plugin} from 'vite-plus/lint/plugins'

import {choicesAreSchemas} from '#lint/choices-are-schemas.ts'
import {effectCallForm} from '#lint/effect-call-form.ts'
import {libraryOperation} from '#lint/library-operation.ts'
import {nameByKind} from '#lint/name-by-kind.ts'
import {noAccumulatingCopy} from '#lint/no-accumulating-copy.ts'
import {noBarrelModule} from '#lint/no-barrel-module.ts'
import {noCollectingLoop} from '#lint/no-collecting-loop.ts'
import {noDestructuredParameter} from '#lint/no-destructured-parameter.ts'
import {noFloatingDerivedType} from '#lint/no-floating-derived-type.ts'
import {noMultilineComment} from '#lint/no-multiline-comment.ts'
import {noNativeMethodCall} from '#lint/no-native-method-call.ts'
import {noPassThroughName} from '#lint/no-pass-through-name.ts'
import {noPropertyAlias} from '#lint/no-property-alias.ts'
import {noRedundantAnnotation} from '#lint/no-redundant-annotation.ts'
import {noReinventedSchema} from '#lint/no-reinvented-schema.ts'
import {noRenamedImport} from '#lint/no-renamed-import.ts'
import {noRepeatedGuard} from '#lint/no-repeated-guard.ts'
import {noRepeatedSearch} from '#lint/no-repeated-search.ts'
import {noStoredSchemaOperation} from '#lint/no-stored-schema-operation.ts'
import {noUnexplainedDisable} from '#lint/no-unexplained-disable.ts'
import {noUnvalidatedJsonDecode} from '#lint/no-unvalidated-json-decode.ts'
import {noWallClock} from '#lint/no-wall-clock.ts'
import {recoverNamedFailures} from '#lint/recover-named-failures.ts'
import {retryPolicy} from '#lint/retry-policy.ts'
import {schemaTypePair} from '#lint/schema-type-pair.ts'
import {serviceMethodSpan} from '#lint/service-method-span.ts'
import {serviceSchemaFile} from '#lint/service-schema-file.ts'
import {testAssertions} from '#lint/test-assertions.ts'
import {testBoundaries} from '#lint/test-boundaries.ts'
import {testRegistration} from '#lint/test-registration.ts'
import {testSynchronization} from '#lint/test-synchronization.ts'

const MAP_MESSAGE =
	'Use HashMap, or MutableHashMap for local mutation; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.'
const NUMBER_CHECK_MESSAGE =
	'Model a missing number with Option and validate one with Schema.Finite; Number.parse reads one from text.'
const RUN_MESSAGE =
	'Run the entry point with NodeRuntime.runMain, and Effects in views through Effect UI. A Promise that an external contract demands takes Effect.runPromise once, with an inline disable that names the contract.'
const RUNNERS = [
	'runCallback',
	'runCallbackWith',
	'runFork',
	'runForkWith',
	'runPromise',
	'runPromiseExit',
	'runPromiseExitWith',
	'runPromiseWith',
	'runSync',
	'runSyncExit',
	'runSyncExitWith',
	'runSyncWith'
]
const SET_MESSAGE =
	'Use HashSet, or MutableHashSet for local mutation; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.'

const RESTRICTED_PROPERTIES = [
	{message: 'Use standalone pipe.', property: 'pipe'},
	{message: 'Name the log level: Effect.logInfo, logWarning, logError or logDebug.', object: 'Effect', property: 'log'},
	// The Effect compiler's preferEffectRecord diagnostic owns keys, values, entries, fromEntries, hasOwn and hasOwnProperty.
	{
		allowProperties: ['entries', 'fromEntries', 'hasOwn', 'keys', 'values'],
		message: "Use Record or Struct from 'effect'.",
		object: 'Object'
	},
	...Array.map(RUNNERS, property => ({message: RUN_MESSAGE, object: 'Effect', property})),
	{message: RUN_MESSAGE, object: 'ManagedRuntime', property: 'make'},
	{message: 'Use Number.max.', object: 'Math', property: 'max'},
	{message: 'Use Option.getOrUndefined; undefined marks an absent value.', object: 'Option', property: 'getOrNull'},
	{message: 'Use Number.min.', object: 'Math', property: 'min'},
	{message: 'Use Number.round.', object: 'Math', property: 'round'},
	{message: 'Use Schema.Struct.', object: 'Schema', property: 'Class'},
	{message: 'Use a branded schema.', object: 'Schema', property: 'Opaque'},
	{message: 'Use Schema.Struct.', object: 'Schema', property: 'TaggedClass'},
	{message: 'Use Schema.Struct.', object: 'Data', property: 'Class'},
	{message: 'Use Schema.TaggedError.', object: 'Data', property: 'Error'},
	{message: 'Use Schema.Struct.', object: 'Data', property: 'TaggedClass'},
	{message: 'Use Schema.TaggedError.', object: 'Data', property: 'TaggedError'},
	...Array.map(
		[
			'addEventListener',
			'cancelAnimationFrame',
			'cancelIdleCallback',
			'dispatchEvent',
			'localStorage',
			'navigator',
			'removeEventListener',
			'requestAnimationFrame',
			'requestIdleCallback',
			'sessionStorage',
			'structuredClone'
		],
		property => ({message: `Use the bare ${property} global.`, object: 'window', property})
	),
	// Effect detects the global calls, but the DOM Window methods resolve to different symbols.
	...Array.map(['setInterval', 'setTimeout'], property => ({
		message: 'Use Effect.sleep or Schedule.',
		object: 'window',
		property
	})),
	{message: 'Use HttpClient.', object: 'window', property: 'fetch'},
	{message: 'Use Clock.', object: 'window', property: 'performance'}
]

// Match Tailwind class arguments, without including the fluent builder or its later children.
function classLiterals(pattern: string) {
	return pipe(
		['Literal[value=/', 'TemplateElement[value.raw=/'],
		Array.flatMap(value => [
			`CallExpression[callee.property.name="class"] > ${value}${pattern}/].arguments`,
			`CallExpression[callee.property.name="class"] > .arguments ${value}${pattern}/]`
		]),
		Array.join(', ')
	)
}

// Checks of Deslop's own choices, which only Deslop's conventions can serve.

const RULES = {
	'choices-are-schemas': choicesAreSchemas,
	'effect-call-form': effectCallForm,
	'library-operation': libraryOperation,
	'name-by-kind': nameByKind,
	'no-accumulating-copy': noAccumulatingCopy,
	'no-barrel-module': noBarrelModule,
	'no-collecting-loop': noCollectingLoop,
	'no-destructured-parameter': noDestructuredParameter,
	'no-floating-derived-type': noFloatingDerivedType,
	'no-multiline-comment': noMultilineComment,
	'no-native-method-call': noNativeMethodCall,
	'no-pass-through-name': noPassThroughName,
	'no-property-alias': noPropertyAlias,
	'no-redundant-annotation': noRedundantAnnotation,
	'no-reinvented-schema': noReinventedSchema,
	'no-renamed-import': noRenamedImport,
	'no-repeated-guard': noRepeatedGuard,
	'no-repeated-search': noRepeatedSearch,
	'no-stored-schema-operation': noStoredSchemaOperation,
	'no-unexplained-disable': noUnexplainedDisable,
	'no-unvalidated-json-decode': noUnvalidatedJsonDecode,
	'no-wall-clock': noWallClock,
	'recover-named-failures': recoverNamedFailures,
	'retry-policy': retryPolicy,
	'schema-type-pair': schemaTypePair,
	'service-method-span': serviceMethodSpan,
	'service-schema-file': serviceSchemaFile,
	'test-assertions': testAssertions,
	'test-boundaries': testBoundaries,
	'test-registration': testRegistration,
	'test-synchronization': testSynchronization
}

const restrictedImports: {
	paths: {importNames?: string[]; message: string; name: string}[]
	patterns: {group: string[]; message: string}[]
} = {
	paths: [{importNames: RUNNERS, message: RUN_MESSAGE, name: 'effect/Effect'}],
	patterns: [
		{group: ['@*/*/src', '@*/*/src/**'], message: 'Use public package exports.'},
		// A service folder's public face is its schema, service and lib/utils; its own files reach the rest with `./`.
		{
			group: [
				'#services/*/*',
				'!#services/*/schema.ts',
				'!#services/*/service.ts',
				'!#services/*/lib',
				'#services/*/lib/*',
				'!#services/*/lib/utils.ts'
			],
			message: 'Import a service only through its schema.ts, service.ts or lib/utils.ts; inside it, use ./.'
		}
	]
}

export const lint: OxlintConfig & {
	rules: {'eslint-js/no-restricted-syntax': ['error', ...{message: string; selector: string}[]]}
} = {
	categories: {
		correctness: 'off',
		nursery: 'off',
		pedantic: 'off',
		perf: 'off',
		restriction: 'off',
		style: 'off',
		suspicious: 'off'
	},
	jsPlugins: [
		{name: '@deslop/coding-standards', specifier: import.meta.url},
		{name: 'effect-machine', specifier: import.meta.resolve('@typeonce/oxlint-plugin-effect-machine')},
		{name: 'eslint-js', specifier: import.meta.resolve('oxlint-plugin-eslint')},
		{name: 'vite-plus', specifier: import.meta.resolve('vite-plus/oxlint-plugin')}
	],
	options: {denyWarnings: true, reportUnusedDisableDirectives: 'deny', typeAware: false, typeCheck: false},
	overrides: [
		{
			excludeFiles: ['**/*.test.ts'],
			files: ['**/*'],
			rules: {
				'eslint/no-restricted-properties': [
					'error',
					...RESTRICTED_PROPERTIES,
					...Array.map(['Option', 'Result'], object => ({
						message: 'Match the result, or carry the known value in its type.',
						object,
						property: 'getOrThrow'
					})),
					{
						message: 'Use a non-empty type or findFirstWithIndex; do not assert an index exists.',
						object: 'Array',
						property: 'getUnsafe'
					}
				]
			}
		},
		{
			files: ['**/packages/ui/**'],
			rules: {
				'@deslop/coding-standards/no-destructured-parameter': 'off',
				'@deslop/coding-standards/no-renamed-import': 'off'
			}
		},
		{files: ['**/*.config.ts'], rules: {'import/no-default-export': 'off'}}
	],
	plugins: ['effecttsgo', 'eslint', 'typescript', 'oxc', 'import', 'node', 'unicorn', 'vitest'],
	rules: {
		...Record.mapEntries(RULES, (_, name) => [`@deslop/coding-standards/${name}`, 'error' as const]),

		'eslint-js/no-restricted-syntax': [
			'error',
			{
				message:
					'Discriminate typed unions with isAnyOf or match; schema guards validate the entire value, including model identity.',
				selector:
					'MemberExpression[object.type="MemberExpression"][object.property.name="guards"], MemberExpression[object.type="MemberExpression"][object.property.value="guards"]'
			},
			{
				message: 'Keep the source error typed; do not widen an error mapper to unknown.',
				selector:
					'CallExpression[callee.property.name="mapError"] > ArrowFunctionExpression > Identifier[typeAnnotation.typeAnnotation.type="TSUnknownKeyword"]'
			},
			{
				message: 'Keep the cause for diagnostics and give this boundary its own actionable message.',
				selector:
					'CallExpression[callee.property.name=/^(make|json|jsonUnsafe|mapError|catch|catchTag|catchTags|catchCause|catchIf)$/] Property[key.name="message"] MemberExpression[property.name="message"], NewExpression[callee.name=/Error$/] MemberExpression[property.name="message"]'
			},
			{message: 'Use const and Effect collection combinators.', selector: 'VariableDeclaration[kind="let"]'},
			{message: 'Use Match.', selector: 'SwitchStatement'},
			{
				message: 'Use a flat theme token such as bg-card or bg-muted.',
				selector: classLiterals('(^|[ :])bg-(linear|radial|conic|gradient)(-|$| )|gradient\\(')
			},
			{
				// A module augmentation is the one place an interface belongs: TypeScript merges declarations only into interfaces.
				message: 'Declare a type, not an interface.',
				selector: 'TSInterfaceDeclaration:not(TSModuleDeclaration TSInterfaceDeclaration)'
			},
			{
				message:
					"A negative margin pulls a box out of its parent's layout; change the parent's layout, or the primitive's size, instead.",
				selector: classLiterals('(^|[\\s:])-m[xytrblse]{0,2}-')
			},
			{
				message:
					'An arbitrary variant writes a selector or condition by hand, and `*:` styles children from outside them; put the class on the element itself, choose its primitive variant, or name the condition once with @custom-variant.',
				selector: classLiterals('(^|[\\s:])(\\[[^\\s]*\\]|\\*{1,2}):')
			}
		],

		'effecttsgo/any-unknown-in-error-context': 'error',
		'effecttsgo/catch-unfailable-effect': 'error',
		'effecttsgo/class-self-mismatch': 'error',
		'effecttsgo/duplicate-package': 'error',
		'effecttsgo/effect-fn-implicit-any': 'error',
		'effecttsgo/error-payload-shadows-name': 'error',
		'effecttsgo/floating-effect': 'error',
		'effecttsgo/floating-effect-in-vitest': 'error',
		'effecttsgo/missing-concurrency-option': 'error',
		'effecttsgo/missing-effect-context': 'error',
		'effecttsgo/missing-effect-error': 'error',
		'effecttsgo/missing-layer-context': 'error',
		'effecttsgo/missing-return-yield-star': 'error',
		'effecttsgo/missing-star-in-yield-effect-gen': 'error',
		'effecttsgo/obsolete-match-import': 'error',
		'effecttsgo/obsolete-schema-import': 'error',
		'effecttsgo/outdated-api': 'error',
		'effecttsgo/overridden-schema-constructor': 'error',
		'effecttsgo/promise-in-effect-success': 'error',
		'effecttsgo/schema-class-object-literal': 'error',
		'effecttsgo/schema-literal-non-finite': 'error',
		'effecttsgo/unknown-in-effect-catch': 'error',

		'effecttsgo/effect-fn-iife': 'error',
		'effecttsgo/effect-gen-uses-adapter': 'error',
		'effecttsgo/effect-in-failure': 'error',
		'effecttsgo/effect-in-void-success': 'error',
		'effecttsgo/effect-try-without-catch': 'error',
		'effecttsgo/global-error-in-effect-catch': 'error',
		'effecttsgo/global-error-in-effect-failure': 'error',
		'effecttsgo/layer-merge-all-with-dependencies': 'error',
		'effecttsgo/lazy-effect': 'error',
		'effecttsgo/lazy-promise-in-effect-sync': 'error',
		'effecttsgo/leaking-requirements': 'error',
		'effecttsgo/multiple-effect-provide': 'error',
		'effecttsgo/return-effect-in-gen': 'error',
		'effecttsgo/schema-sync-in-effect': 'error',
		'effecttsgo/strict-effect-provide': 'error',
		'effecttsgo/try-catch-in-effect-gen': 'error',

		'effecttsgo/async-function': 'error',
		'effecttsgo/global-console': 'error',
		'effecttsgo/global-console-in-effect': 'error',
		'effecttsgo/global-date': 'error',
		'effecttsgo/global-date-in-effect': 'error',
		'effecttsgo/global-fetch': 'error',
		'effecttsgo/global-fetch-in-effect': 'error',
		'effecttsgo/global-json': 'error',
		'effecttsgo/global-json-in-effect': 'error',
		'effecttsgo/global-random': 'error',
		'effecttsgo/global-random-in-effect': 'error',
		'effecttsgo/global-timers': 'error',
		'effecttsgo/global-timers-in-effect': 'error',
		'effecttsgo/instance-of-schema': 'error',
		'effecttsgo/node-builtin-import': 'error',
		'effecttsgo/prefer-effect-array': 'error',
		'effecttsgo/prefer-effect-record': 'error',
		'effecttsgo/prefer-effect-string': 'error',
		'effecttsgo/process-env': 'error',
		'effecttsgo/process-env-in-effect': 'error',

		'effecttsgo/acquire-release-disposable': 'error',
		'effecttsgo/all-of-map-to-for-each': 'error',
		'effecttsgo/catch-if-tag-to-catch-tag': 'error',
		'effecttsgo/catch-tag-to-catch-reason': 'error',
		'effecttsgo/deterministic-keys': 'error',
		'effecttsgo/effect-do-notation': 'error',
		'effecttsgo/effect-fn-opportunity': 'error',
		'effecttsgo/effect-map-flatten': 'error',
		'effecttsgo/effect-map-void': 'error',
		'effecttsgo/effect-sleep-zero-to-yield-now': 'error',
		'effecttsgo/effect-succeed-with-undefined': 'error',
		'effecttsgo/effect-succeed-with-void': 'error',
		'effecttsgo/fail-cause-to-constructor': 'error',
		'effecttsgo/flat-map-conditional-to-filter-or-fail': 'error',
		'effecttsgo/flat-map-identity-to-flatten': 'error',
		'effecttsgo/flat-map-ignored-param-to-and-then': 'error',
		'effecttsgo/flat-map-provide-service-to-provide-service-effect': 'error',
		'effecttsgo/flat-map-to-map': 'error',
		'effecttsgo/flat-map-to-tap': 'error',
		'effecttsgo/for-loop-push-to-for-each': 'error',
		'effecttsgo/manual-metric-tap-to-track': 'error',
		'effecttsgo/map-const-to-as': 'error',
		'effecttsgo/map-map-error-to-map-both': 'error',
		'effecttsgo/map-some-catch-no-such-element': 'error',
		'effecttsgo/map-some-to-as-some': 'error',
		'effecttsgo/match-boolean-to-is-success': 'error',
		'effecttsgo/match-effect-to-map-both': 'error',
		'effecttsgo/match-effect-to-match': 'error',
		'effecttsgo/match-to-result-or-option': 'error',
		'effecttsgo/multiple-catch-tag': 'error',
		'effecttsgo/nested-effect-gen-yield': 'error',
		'effecttsgo/new-schema-class': 'error',
		'effecttsgo/on-exit-failure-to-on-error': 'error',
		'effecttsgo/option-match-to-from-option': 'error',
		'effecttsgo/prefer-schema-type-property': 'error',
		'effecttsgo/prefer-succeed-some-or-none': 'error',
		'effecttsgo/prefer-typed-schema-decoder': 'error',
		'effecttsgo/provide-layer-succeed-to-provide-service': 'error',
		'effecttsgo/provide-merge-all-to-array': 'error',
		'effecttsgo/race-first-with-sleep-to-timeout': 'error',
		'effecttsgo/redundant-map-error': 'error',
		'effecttsgo/redundant-schema-tag-identifier': 'error',
		'effecttsgo/result-match-to-from-result': 'error',
		'effecttsgo/run-of-exit-to-run-exit': 'error',
		'effecttsgo/schema-number': 'error',
		'effecttsgo/schema-struct-with-tag': 'error',
		'effecttsgo/service-not-as-class': 'error',
		'effecttsgo/suspend-fail-to-fail-sync': 'error',
		'effecttsgo/sync-to-succeed': 'error',
		'effecttsgo/timeout-catch-tag-to-timeout-or-else': 'error',
		'effecttsgo/unnecessary-effect-gen': 'error',
		'effecttsgo/unnecessary-fail-yieldable-error': 'error',
		'effecttsgo/unnecessary-pipe': 'error',
		// effect-call-form flattens a nested pipe only where its steps keep their evaluation order, and fixes it; a method pipe is restricted.
		'effecttsgo/unnecessary-pipe-chain': 'off',
		'effecttsgo/unnecessary-typeof-type': 'error',

		'eslint/accessor-pairs': ['error', {enforceForClassMembers: true, enforceForTSTypes: true}],
		'eslint/arrow-body-style': ['error', 'as-needed'],
		'eslint/constructor-super': 'error',
		'eslint/curly': ['error', 'multi-line', 'consistent'],
		'eslint/default-param-last': 'error',
		'eslint/eqeqeq': 'error',
		'eslint/for-direction': 'error',
		'eslint/func-names': ['error', 'as-needed', {generators: 'never'}],
		'eslint/func-style': [
			'error',
			'declaration',
			{allowArrowFunctions: false, allowTypeAnnotation: false, overrides: {namedExports: 'declaration'}}
		],
		'eslint/grouped-accessor-pairs': 'error',
		'eslint/logical-assignment-operators': 'error',
		'eslint/no-alert': 'error',
		'eslint/no-await-in-loop': 'error',
		'eslint/no-caller': 'error',
		'eslint/no-compare-neg-zero': 'error',
		'eslint/no-cond-assign': ['error', 'always'],
		'eslint/no-constant-binary-expression': ['error', {checkRelationalComparisons: true}],
		'eslint/no-constant-condition': ['error', {checkLoops: 'all'}],
		'eslint/no-constructor-return': 'error',
		'eslint/no-continue': 'error',
		'eslint/no-control-regex': 'error',
		'eslint/no-debugger': 'error',
		'eslint/no-delete-var': 'error',
		'eslint/no-div-regex': 'error',
		'eslint/no-dupe-else-if': 'error',
		'eslint/no-else-return': ['error', {allowElseIf: false}],
		'eslint/no-empty': 'error',
		'eslint/no-empty-character-class': 'error',
		'eslint/no-empty-function': 'error',
		'eslint/no-empty-pattern': 'error',
		'eslint/no-empty-static-block': 'error',
		'eslint/no-eval': 'error',
		'eslint/no-ex-assign': 'error',
		'eslint/no-extend-native': 'error',
		'eslint/no-extra-bind': 'error',
		'eslint/no-global-assign': 'error',
		'eslint/no-implicit-coercion': 'error',
		'eslint/no-implied-eval': 'error',
		'eslint/no-inline-comments': 'error',
		'eslint/no-invalid-regexp': 'error',
		'eslint/no-irregular-whitespace': 'error',
		'eslint/no-iterator': 'error',
		'eslint/no-labels': 'error',
		'eslint/no-lone-blocks': 'error',
		'eslint/no-lonely-if': 'error',
		'eslint/no-loss-of-precision': 'error',
		'eslint/no-misleading-character-class': 'error',
		'eslint/no-multi-assign': 'error',
		'eslint/no-multi-str': 'error',
		'eslint/no-negated-condition': 'error',
		'eslint/no-new': 'error',
		'eslint/no-new-func': 'error',
		'eslint/no-nonoctal-decimal-escape': 'error',
		'eslint/no-object-constructor': 'error',
		'eslint/no-param-reassign': ['error', {props: true}],
		'eslint/no-plusplus': 'error',
		'eslint/no-proto': 'error',
		'eslint/no-regex-spaces': 'error',
		'eslint/no-restricted-globals': [
			'error',
			{
				checkGlobalObject: true,
				globalObjects: ['window'],
				globals: [
					{message: 'Use import.meta.dirname.', name: '__dirname'},
					{message: 'Use import.meta.filename.', name: '__filename'},
					{message: 'Interrupt an Effect fiber or close its Scope.', name: 'clearTimeout'},
					{message: 'Interrupt an Effect fiber or close its Scope.', name: 'clearInterval'},
					{message: 'Schedule work with Effect and Scope.', name: 'setImmediate'},
					{message: 'Interrupt an Effect fiber or close its Scope.', name: 'clearImmediate'},
					{message: 'Schedule work with Effect and Scope.', name: 'queueMicrotask'},
					{message: 'Interrupt through Effect: a fiber, Effect.timeout, or a Scope.', name: 'AbortController'},
					{message: "Import Array from 'effect'.", name: 'Array'},
					{message: 'Use Base64 or Base64Url from effect/encoding.', name: 'atob'},
					{message: "Import Boolean from 'effect'.", name: 'Boolean'},
					{message: 'Use Base64 or Base64Url from effect/encoding.', name: 'btoa'},
					{message: 'Use the effect/crypto services: SecureRandom, Digest, Signature.', name: 'crypto'},
					{message: 'Define a Schema.TaggedError and fail with it.', name: 'Error'},
					{message: NUMBER_CHECK_MESSAGE, name: 'isFinite'},
					{message: NUMBER_CHECK_MESSAGE, name: 'isNaN'},
					{message: MAP_MESSAGE, name: 'Map'},
					{message: NUMBER_CHECK_MESSAGE, name: 'NaN'},
					{message: "Import Number from 'effect'.", name: 'Number'},
					{message: 'Use Number.parse.', name: 'parseFloat'},
					{message: 'Use Number.parse.', name: 'parseInt'},
					{message: 'Use Effect: Effect.tryPromise at the boundary, Effect.all to combine.', name: 'Promise'},
					{message: "Use Predicate or Record from 'effect'.", name: 'Reflect'},
					{message: SET_MESSAGE, name: 'Set'},
					{message: "Import String from 'effect'.", name: 'String'},
					{message: 'Read configuration with Config and services from the context.', name: 'global'},
					{message: 'Read configuration with Config and services from the context.', name: 'globalThis'}
				]
			}
		],
		'eslint/no-restricted-imports': ['error', restrictedImports],
		'eslint/no-restricted-properties': ['error', ...RESTRICTED_PROPERTIES],
		'eslint/no-return-assign': 'error',
		'eslint/no-self-assign': 'error',
		'eslint/no-self-compare': 'error',
		'eslint/no-sequences': ['error', {allowInParentheses: false}],
		'eslint/no-shadow': [
			'error',
			{allow: ['Array', 'Boolean', 'Console', 'Effect', 'HashMap', 'Number', 'Option', 'Schema', 'String']}
		],
		'eslint/no-shadow-restricted-names': ['error', {reportGlobalThis: true}],
		'eslint/no-sparse-arrays': 'error',
		'eslint/no-ternary': 'error',
		'eslint/no-throw-literal': 'error',
		'eslint/no-unexpected-multiline': 'error',
		'eslint/no-unmodified-loop-condition': ['error', {checkConditionalExpressions: true}],
		'eslint/no-unreachable-loop': 'error',
		'eslint/no-unsafe-finally': 'error',
		'eslint/no-unsafe-negation': ['error', {enforceForOrderingRelations: true}],
		'eslint/no-unsafe-optional-chaining': ['error', {disallowArithmeticOperators: true}],
		'eslint/no-unused-expressions': [
			'error',
			{
				allowShortCircuit: false,
				allowTaggedTemplates: false,
				allowTernary: false,
				enforceForJSX: true,
				ignoreDirectives: false
			}
		],
		'eslint/no-use-before-define': ['error', {classes: true, functions: true, typedefs: false, variables: true}],
		'eslint/no-useless-backreference': 'error',
		'eslint/no-useless-call': 'error',
		'eslint/no-useless-catch': 'error',
		'eslint/no-useless-computed-key': ['error', {enforceForClassMembers: true}],
		'eslint/no-useless-concat': 'error',
		'eslint/no-useless-constructor': 'error',
		'eslint/no-useless-escape': 'error',
		'eslint/no-useless-rename': 'error',
		'eslint/no-useless-return': 'error',
		'eslint/no-var': 'error',
		'eslint/no-void': 'error',
		'eslint/no-warning-comments': ['error', {location: 'anywhere'}],
		'eslint/no-with': 'error',
		'eslint/object-shorthand': 'error',
		'eslint/prefer-arrow-callback': 'error',
		'eslint/prefer-exponentiation-operator': 'error',
		'eslint/prefer-regex-literals': ['error', {disallowRedundantWrapping: true}],
		'eslint/prefer-rest-params': 'error',
		'eslint/prefer-spread': 'error',
		'eslint/prefer-template': 'error',
		'eslint/preserve-caught-error': ['error', {requireCatchParameter: true}],
		'eslint/require-unicode-regexp': 'error',
		'eslint/require-yield': 'error',
		'eslint/sort-keys': ['error', 'asc', {allowLineSeparatedGroups: true, natural: true}],
		'eslint/symbol-description': 'error',
		'eslint/unicode-bom': 'error',
		'eslint/valid-typeof': 'error',
		'eslint/yoda': 'error',

		'import/extensions': ['error', 'always', {ignorePackages: true}],
		'import/first': 'error',
		'import/newline-after-import': 'error',
		'import/no-absolute-path': 'error',
		'import/no-amd': 'error',
		'import/no-commonjs': ['error', {allowConditionalRequire: false}],
		'import/no-default-export': 'error',
		'import/no-duplicates': 'error',
		'import/no-empty-named-blocks': 'error',
		'import/no-named-as-default': 'error',
		'import/no-named-as-default-member': 'error',
		'import/no-named-default': 'error',
		'import/no-namespace': 'error',
		'import/no-relative-parent-imports': 'error',
		'import/no-self-import': 'error',
		// Effect UI native skips React Native's renderer, so iPhone apps start its timers and XHR themselves.
		'import/no-unassigned-import': [
			'error',
			{allow: ['**/*.css', 'react-native/Libraries/Core/setUpTimers', 'react-native/Libraries/Core/setUpXHR']}
		],

		...recommended,

		'node/no-path-concat': 'error',
		'node/no-top-level-await': ['error', {ignoreBin: false}],

		'oxc/approx-constant': 'error',
		'oxc/bad-array-method-on-arguments': 'error',
		'oxc/bad-bitwise-operator': 'error',
		'oxc/bad-char-at-comparison': 'error',
		'oxc/bad-comparison-sequence': 'error',
		'oxc/bad-match-all-arg': 'error',
		'oxc/bad-replace-all-arg': 'error',
		'oxc/branches-sharing-code': 'error',
		'oxc/const-comparisons': 'error',
		'oxc/double-comparisons': 'error',
		'oxc/erasing-op': 'error',
		'oxc/misrefactored-assign-op': 'error',
		'oxc/no-this-in-exported-function': 'error',
		'oxc/number-arg-out-of-range': 'error',
		'oxc/only-used-in-recursion': 'error',
		'oxc/uninvoked-array-callback': 'error',

		'typescript/adjacent-overload-signatures': 'error',
		'typescript/ban-ts-comment': [
			'error',
			{'ts-check': true, 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true}
		],
		'typescript/class-literal-property-style': 'error',
		'typescript/consistent-generic-constructors': 'error',
		'typescript/consistent-indexed-object-style': 'error',
		'typescript/consistent-type-assertions': [
			'error',
			{arrayLiteralTypeAssertions: 'never', assertionStyle: 'never', objectLiteralTypeAssertions: 'never'}
		],
		'typescript/consistent-type-imports': ['error', {fixStyle: 'separate-type-imports', prefer: 'type-imports'}],
		'typescript/method-signature-style': 'error',
		'typescript/no-dynamic-delete': 'error',
		'typescript/no-empty-object-type': 'error',
		'typescript/no-explicit-any': 'error',
		'typescript/no-extraneous-class': 'error',
		'typescript/no-import-type-side-effects': 'error',
		'typescript/no-inferrable-types': ['error', {ignoreParameters: true}],
		'typescript/no-misused-new': 'error',
		'typescript/no-namespace': ['error', {allowDeclarations: false, allowDefinitionFiles: false}],
		'typescript/no-non-null-assertion': 'error',
		'typescript/no-restricted-types': [
			'error',
			{
				types: {
					AbortController: 'Use Effect interruption.',
					Array: 'Use T[].',
					Date: 'Use DateTime.',
					Error: 'Use Schema.TaggedError.',
					Iterable: 'Use T[].',
					Map: MAP_MESSAGE,
					Promise: 'Use Effect.',
					ReadonlyArray: 'Use readonly T[].',
					ReadonlyMap: MAP_MESSAGE,
					ReadonlySet: SET_MESSAGE,
					Set: SET_MESSAGE,
					undefined: 'Use an optional property or parameter, or let inference supply undefined.'
				}
			}
		],
		'typescript/no-this-alias': ['error', {allowDestructuring: false, allowedNames: []}],
		'typescript/no-unnecessary-type-constraint': 'error',
		'typescript/no-unsafe-declaration-merging': 'error',
		'typescript/no-unsafe-function-type': 'error',
		'typescript/no-wrapper-object-types': 'error',
		'typescript/prefer-function-type': 'error',
		'typescript/triple-slash-reference': ['error', {lib: 'never', path: 'never', types: 'never'}],
		'typescript/unified-signatures': 'error',

		'typescript/await-thenable': 'error',
		'typescript/consistent-type-exports': 'error',
		'typescript/dot-notation': 'error',
		'typescript/no-array-delete': 'error',
		'typescript/no-base-to-string': 'error',
		'typescript/no-confusing-void-expression': ['error', {ignoreVoidReturningFunctions: true}],
		'typescript/no-deprecated': 'error',
		'typescript/no-duplicate-type-constituents': 'error',
		'typescript/no-floating-promises': 'error',
		'typescript/no-for-in-array': 'error',
		'typescript/no-generated-empty-object-type': 'error',
		'typescript/no-misused-promises': 'error',
		'typescript/no-misused-spread': 'error',
		'typescript/no-redundant-type-constituents': 'error',
		'typescript/no-unnecessary-boolean-literal-compare': 'error',
		'typescript/no-unnecessary-condition': 'error',
		'typescript/no-unnecessary-qualifier': 'error',
		'typescript/no-unnecessary-template-expression': 'error',
		'typescript/no-unnecessary-type-arguments': 'error',
		'typescript/no-unnecessary-type-conversion': 'error',
		'typescript/no-unnecessary-type-parameters': 'error',
		'typescript/no-unsafe-argument': 'error',
		'typescript/no-unsafe-assignment': 'error',
		'typescript/no-unsafe-call': 'error',
		'typescript/no-unsafe-enum-comparison': 'error',
		'typescript/no-unsafe-member-access': 'error',
		'typescript/no-unsafe-return': 'error',
		'typescript/no-unsafe-unary-minus': 'error',
		'typescript/no-useless-default-assignment': 'error',
		'typescript/only-throw-error': 'error',
		'typescript/prefer-nullish-coalescing': ['error', {ignoreTernaryTests: true}],
		'typescript/prefer-optional-chain': 'error',
		'typescript/prefer-readonly': ['error', {}],
		'typescript/related-getter-setter-pairs': 'error',
		'typescript/restrict-plus-operands': [
			'error',
			{
				allowAny: false,
				allowBoolean: false,
				allowNullish: false,
				allowNumberAndString: false,
				allowRegExp: false,
				skipCompoundAssignments: false
			}
		],
		'typescript/restrict-template-expressions': 'error',
		'typescript/strict-boolean-expressions': [
			'error',
			// A non-empty fallback such as `name || 'missing'` is the house idiom; nullable booleans, numbers and objects stay explicit.
			{allowNullableObject: false, allowNullableString: true, allowNumber: false, allowString: true}
		],
		'typescript/strict-void-return': 'error',
		'typescript/unbound-method': 'error',

		'unicorn/consistent-empty-array-spread': 'error',
		'unicorn/consistent-function-scoping': 'error',
		'unicorn/consistent-template-literal-escape': 'error',
		'unicorn/filename-case': ['error', {case: 'kebabCase', ignore: [], multipleFileExtensions: false}],
		'unicorn/no-abusive-eslint-disable': 'error',
		'unicorn/no-accessor-recursion': 'error',
		'unicorn/no-await-expression-member': 'error',
		'unicorn/no-document-cookie': 'error',
		'unicorn/no-empty-file': 'error',
		'unicorn/no-immediate-mutation': 'error',
		'unicorn/no-instanceof-builtins': 'error',
		'unicorn/no-invalid-fetch-options': 'error',
		'unicorn/no-invalid-remove-event-listener': 'error',
		'unicorn/no-negation-in-equality-check': 'error',
		'unicorn/no-null': 'error',
		'unicorn/no-object-as-default-parameter': 'error',
		'unicorn/no-process-exit': 'error',
		'unicorn/no-thenable': 'error',
		'unicorn/no-unnecessary-await': 'error',
		'unicorn/no-unreadable-array-destructuring': 'error',
		'unicorn/no-unreadable-iife': 'error',
		'unicorn/no-useless-fallback-in-spread': 'error',
		'unicorn/no-useless-spread': 'error',
		'unicorn/numeric-separators-style': 'error',
		'unicorn/prefer-add-event-listener': 'error',
		'unicorn/prefer-bigint-literals': 'error',
		'unicorn/prefer-blob-reading-methods': 'error',
		'unicorn/prefer-class-fields': 'error',
		'unicorn/prefer-classlist-toggle': 'error',
		'unicorn/prefer-dom-node-remove': 'error',
		'unicorn/prefer-import-meta-properties': 'error',
		'unicorn/prefer-modern-dom-apis': 'error',
		'unicorn/prefer-node-protocol': 'error',
		'unicorn/prefer-optional-catch-binding': 'error',
		// The compiler's preferEffectString moves native string methods to Effect's String, whose replace with a global pattern this still turns into replaceAll.
		'unicorn/prefer-string-replace-all': 'error',
		'unicorn/require-module-attributes': 'error',
		'unicorn/require-module-specifiers': 'error',
		'unicorn/require-number-to-fixed-digits-argument': 'error',
		'unicorn/require-post-message-target-origin': 'error',
		'unicorn/text-encoding-identifier-case': ['error', {}],

		'vitest/consistent-each-for': ['error', {}],
		'vitest/consistent-test-filename': ['error', {}],
		'vitest/expect-expect': 'error',
		'vitest/max-nested-describe': ['error', {}],
		'vitest/no-commented-out-tests': 'error',
		'vitest/no-conditional-tests': 'error',
		'vitest/no-disabled-tests': 'error',
		'vitest/no-duplicate-hooks': 'error',
		'vitest/no-focused-tests': 'error',
		'vitest/no-identical-title': 'error',
		'vitest/no-import-node-test': 'error',
		'vitest/no-test-return-statement': 'error',
		'vitest/padding-around-after-all-blocks': 'error',
		'vitest/padding-around-test-blocks': 'error',
		'vitest/prefer-each': 'error',
		'vitest/prefer-hooks-in-order': 'error',
		'vitest/prefer-hooks-on-top': 'error',
		'vitest/prefer-lowercase-title': ['error', {allowedPrefixes: [], ignore: [], ignoreTopLevelDescribe: false}],
		'vitest/valid-describe-callback': 'error',
		'vitest/valid-title': 'error',
		'vitest/warn-todo': 'error',

		'vite-plus/prefer-vite-plus-imports': 'error'
	}
}

const plugin: Plugin = definePlugin({meta: {name: '@deslop/coding-standards'}, rules: RULES})

// oxlint-disable-next-line import/no-default-export -- Vite+ loads a lint plugin from its module's default export.
export default plugin
