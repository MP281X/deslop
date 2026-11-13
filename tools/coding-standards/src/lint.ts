import {Array, Record} from 'effect'

import {recommended} from '@typeonce/oxlint-plugin-effect-machine/recommended'
import type {OxlintConfig} from 'vite-plus/lint'
import {definePlugin} from 'vite-plus/lint/plugins'
import type {Plugin} from 'vite-plus/lint/plugins'

import {choicesAreSchemas} from '#lint/choices-are-schemas.ts'
import {effectCallForm} from '#lint/effect-call-form.ts'
import {explicitEffectConcurrency} from '#lint/explicit-effect-concurrency.ts'
import {moduleConstant} from '#lint/module-constant.ts'
import {noAccumulatingCopy} from '#lint/no-accumulating-copy.ts'
import {noBarrelModule} from '#lint/no-barrel-module.ts'
import {noClickableBadge} from '#lint/no-clickable-badge.ts'
import {noCollectingLoop} from '#lint/no-collecting-loop.ts'
import {noCompilerOptOut} from '#lint/no-compiler-opt-out.ts'
import {noComponentAtomAllocation} from '#lint/no-component-atom-allocation.ts'
import {noDestructuredParameter} from '#lint/no-destructured-parameter.ts'
import {noDoubleNullishCheck} from '#lint/no-double-nullish-check.ts'
import {noFakeRefState} from '#lint/no-fake-ref-state.ts'
import {noFloatingDerivedType} from '#lint/no-floating-derived-type.ts'
import {noHandWrittenHelper} from '#lint/no-hand-written-helper.ts'
import {noIntermediateCollection} from '#lint/no-intermediate-collection.ts'
import {noMisleadingBooleanName} from '#lint/no-misleading-boolean-name.ts'
import {noMultilineComment} from '#lint/no-multiline-comment.ts'
import {noNativeControl} from '#lint/no-native-control.ts'
import {noNativeEmptinessCheck} from '#lint/no-native-emptiness-check.ts'
import {noNativeMethodCall} from '#lint/no-native-method-call.ts'
import {noOptionValueAccess} from '#lint/no-option-value-access.ts'
import {noPropertyAlias} from '#lint/no-property-alias.ts'
import {noRedundantAnnotation} from '#lint/no-redundant-annotation.ts'
import {noReinventedSchema} from '#lint/no-reinvented-schema.ts'
import {noRenamedImport} from '#lint/no-renamed-import.ts'
import {noRepeatedGuard} from '#lint/no-repeated-guard.ts'
import {noRepeatedSearch} from '#lint/no-repeated-search.ts'
import {noSingleUseValue} from '#lint/no-single-use-value.ts'
import {noStoredJsx} from '#lint/no-stored-jsx.ts'
import {noStoredSchemaOperation} from '#lint/no-stored-schema-operation.ts'
import {noTrivialIndirection} from '#lint/no-trivial-indirection.ts'
import {noUnexplainedDisable} from '#lint/no-unexplained-disable.ts'
import {noUnvalidatedJsonDecode} from '#lint/no-unvalidated-json-decode.ts'
import {noWallClock} from '#lint/no-wall-clock.ts'
import {preferPredicate} from '#lint/prefer-predicate.ts'
import {recoverNamedFailures} from '#lint/recover-named-failures.ts'
import {schemaTypePair} from '#lint/schema-type-pair.ts'
import {serviceMethodSpan} from '#lint/service-method-span.ts'
import {serviceSchemaFile} from '#lint/service-schema-file.ts'
import {swiftuiThemeValues} from '#lint/swiftui-theme-values.ts'
import {testAssertions} from '#lint/test-assertions.ts'
import {testBoundaries} from '#lint/test-boundaries.ts'
import {testRegistration} from '#lint/test-registration.ts'
import {testSynchronization} from '#lint/test-synchronization.ts'

const REACT_LEGACY_APIS = [
	'Component',
	'PureComponent',
	'createRef',
	'forwardRef',
	'memo',
	'useCallback',
	'useEffect',
	'useLayoutEffect',
	'useMemo',
	'useReducer',
	'useSyncExternalStore'
]
const REACT_LEGACY_MESSAGE =
	'Use React 19 function components with refs as props; React Compiler owns memoization, atoms own effects, subscriptions and state machines, and ref callbacks own DOM listeners.'
const MAP_MESSAGE =
	'Use HashMap, or MutableHashMap for local mutation; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.'
const NUMBER_CHECK_MESSAGE =
	'Model a missing number with Option and validate one with Schema.Finite; Number.parse reads one from text.'
const RUN_MESSAGE =
	'Run the entry point with NodeRuntime.runMain, and Effects in React through atoms. A Promise that an external contract demands takes Effect.runPromise once, with an inline disable that names the contract.'
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

// Checks of Deslop's own choices, which only Deslop's conventions can serve.

const RULES = {
	'choices-are-schemas': choicesAreSchemas,
	'effect-call-form': effectCallForm,
	'explicit-effect-concurrency': explicitEffectConcurrency,
	'module-constant': moduleConstant,
	'no-accumulating-copy': noAccumulatingCopy,
	'no-barrel-module': noBarrelModule,
	'no-clickable-badge': noClickableBadge,
	'no-collecting-loop': noCollectingLoop,
	'no-compiler-opt-out': noCompilerOptOut,
	'no-component-atom-allocation': noComponentAtomAllocation,
	'no-destructured-parameter': noDestructuredParameter,
	'no-double-nullish-check': noDoubleNullishCheck,
	'no-fake-ref-state': noFakeRefState,
	'no-floating-derived-type': noFloatingDerivedType,
	'no-hand-written-helper': noHandWrittenHelper,
	'no-intermediate-collection': noIntermediateCollection,
	'no-misleading-boolean-name': noMisleadingBooleanName,
	'no-multiline-comment': noMultilineComment,
	'no-native-control': noNativeControl,
	'no-native-emptiness-check': noNativeEmptinessCheck,
	'no-native-method-call': noNativeMethodCall,
	'no-option-value-access': noOptionValueAccess,
	'no-property-alias': noPropertyAlias,
	'no-redundant-annotation': noRedundantAnnotation,
	'no-reinvented-schema': noReinventedSchema,
	'no-renamed-import': noRenamedImport,
	'no-repeated-guard': noRepeatedGuard,
	'no-repeated-search': noRepeatedSearch,
	'no-single-use-value': noSingleUseValue,
	'no-stored-jsx': noStoredJsx,
	'no-stored-schema-operation': noStoredSchemaOperation,
	'no-trivial-indirection': noTrivialIndirection,
	'no-unexplained-disable': noUnexplainedDisable,
	'no-unvalidated-json-decode': noUnvalidatedJsonDecode,
	'no-wall-clock': noWallClock,
	'prefer-predicate': preferPredicate,
	'recover-named-failures': recoverNamedFailures,
	'schema-type-pair': schemaTypePair,
	'service-method-span': serviceMethodSpan,
	'service-schema-file': serviceSchemaFile,
	'swiftui-theme-values': swiftuiThemeValues,
	'test-assertions': testAssertions,
	'test-boundaries': testBoundaries,
	'test-registration': testRegistration,
	'test-synchronization': testSynchronization
}

// The type keeps the export declarable under isolated declarations, which can't infer the spread entries.
export const restrictedImports: {
	paths: {importNames?: string[]; message: string; name: string}[]
	patterns: {group: string[]; message: string}[]
} = {
	paths: [
		{importNames: ['default', ...REACT_LEGACY_APIS], message: REACT_LEGACY_MESSAGE, name: 'react'},
		{importNames: RUNNERS, message: RUN_MESSAGE, name: 'effect/Effect'}
	],
	patterns: [
		{group: ['@*/*/src', '@*/*/src/**', '@*/*/lib', '@*/*/lib/**'], message: 'Use public package exports.'},
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
		{name: 'react-doctor', specifier: import.meta.resolve('oxlint-plugin-react-doctor')},
		{name: 'shadcn', specifier: import.meta.resolve('@shadcn/lint')},
		{name: 'vite-plus', specifier: import.meta.resolve('vite-plus/oxlint-plugin')}
	],
	options: {denyWarnings: true, reportUnusedDisableDirectives: 'deny', typeAware: false, typeCheck: false},
	overrides: [
		{files: ['**/*.config.ts', '**/app.plugin.js'], rules: {'import/no-default-export': 'off'}},
		// Expo resolves a config plugin only from the package's app.plugin.js, which re-exports the plugin.
		{files: ['**/app.plugin.js'], rules: {'@deslop/coding-standards/no-barrel-module': 'off'}},
		{files: ['**/components/ui/**'], rules: {'shadcn/no-restyle': 'off', 'shadcn/require-static-classes': 'off'}},
		{
			files: ['**/components/ui/**', '**/packages/ui/**'],
			rules: {
				'@deslop/coding-standards/no-destructured-parameter': 'off',
				'@deslop/coding-standards/no-native-control': 'off',
				'@deslop/coding-standards/no-renamed-import': 'off',
				'jsx-a11y/click-events-have-key-events': 'off',
				'jsx-a11y/label-has-associated-control': 'off'
			}
		},
		{files: ['**/*.ts'], rules: {'react/rules-of-hooks': 'off'}},
		{
			files: ['**/*.tsx'],
			rules: {
				'effecttsgo/async-function': 'off',
				'eslint/require-await': 'error',
				'typescript/strict-void-return': 'off',
				'unicorn/no-null': 'off'
			}
		}
	],
	plugins: ['effecttsgo', 'eslint', 'typescript', 'oxc', 'import', 'jsx-a11y', 'node', 'react', 'unicorn', 'vitest'],
	rules: {
		...Record.mapEntries(RULES, (_, name) => [`@deslop/coding-standards/${name}`, 'error' as const]),

		'eslint-js/no-restricted-syntax': [
			'error',
			{
				message:
					'Name this declaration for the domain value it holds; data, info, obj, temp, tmp, helper, manager and handle hide that meaning.',
				selector:
					':matches(VariableDeclarator > Identifier.id, FunctionDeclaration > Identifier.id, ClassDeclaration > Identifier.id, :matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > Identifier.params, CatchClause > Identifier.param)[name=/^(data|info|obj|temp|tmp|helper|manager|handle)$/]'
			},
			{
				message: 'Name an error class <Domain>Error.',
				selector:
					'ClassDeclaration[superClass.callee.callee.object.name="Schema"][superClass.callee.callee.property.name="TaggedError"]:not([id.name=/Error$/])'
			},
			{
				message: 'Name a span Service.method.',
				selector:
					'CallExpression[callee.object.name="Effect"][callee.property.name=/^(withSpan|fn)$/] > Literal.arguments[value]:not([value=/^[A-Z][A-Za-z]*\\.[a-z][A-Za-z]*$/])'
			},
			{
				message: 'Name an atom with the Atom suffix.',
				selector:
					'VariableDeclarator:not([id.name=/(Atom|Runtime|Atoms)$/]) > CallExpression.init:matches([callee.object.name="Atom"][callee.property.name=/^(make|readable|fn|fnSync|runtime|writable|family|keepAlive|withLabel)$/], [callee.property.name=/^(atom|fn|pull)$/][callee.object.property.name="runtime"], [callee.property.name=/^(atom|fn|pull)$/][callee.object.name=/Runtime$/], [callee.property.name=/^(atom|fn|pull)$/][callee.object.callee.object.name="Atom"][callee.object.callee.property.name="runtime"])'
			},
			{
				message: 'Name an error mapping combinator as<Domain>Error.',
				selector:
					'VariableDeclarator:not([id.name=/^as[A-Z]\\w*Error$/]) > CallExpression[callee.object.name="Effect"][callee.property.name="mapError"][arguments.length=1]'
			},
			{message: 'Use const and Effect collection combinators.', selector: 'VariableDeclaration[kind="let"]'},
			{message: 'Use Match.', selector: 'SwitchStatement'},
			{message: 'Decode with Schema or use Predicate.hasProperty.', selector: 'BinaryExpression[operator="in"]'},
			{
				// A module augmentation is the one place an interface belongs: TypeScript merges declarations only into interfaces.
				message: 'Declare a type, not an interface.',
				selector: 'TSInterfaceDeclaration:not(TSModuleDeclaration TSInterfaceDeclaration)'
			},
			{
				message: 'Name tools in snake_case.',
				selector:
					'CallExpression[callee.object.name="Tool"][callee.property.name="make"] > Literal.arguments:first-child:not([value=/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/])'
			}
		],

		'effecttsgo/any-unknown-in-error-context': 'error',
		'effecttsgo/class-self-mismatch': 'error',
		'effecttsgo/duplicate-package': 'error',
		'effecttsgo/effect-fn-implicit-any': 'error',
		'effecttsgo/error-payload-shadows-name': 'error',
		'effecttsgo/floating-effect': 'error',
		'effecttsgo/floating-effect-in-vitest': 'error',
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
		'effecttsgo/flat-map-to-map': 'error',
		'effecttsgo/flat-map-to-tap': 'error',
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
		'effecttsgo/unnecessary-pipe-chain': 'error',
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
		'eslint/no-restricted-exports': [
			'error',
			{restrictedNamedExportsPattern: '^(?:config|get|layer|list|live|make|run|Error|Failure)$|Live$'}
		],
		'eslint/no-restricted-globals': [
			'error',
			{
				checkGlobalObject: true,
				globalObjects: ['window'],
				globals: [
					{message: 'Use import.meta.dirname.', name: '__dirname'},
					{message: 'Use import.meta.filename.', name: '__filename'},
					{message: 'Use Effect logging or Console from effect.', name: 'console'},
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
		'eslint/no-restricted-properties': [
			'error',
			{message: 'Use standalone pipe.', property: 'pipe'},
			{
				message: 'Name the log level: Effect.logInfo, logWarning, logError or logDebug.',
				object: 'Effect',
				property: 'log'
			},
			...Array.map(['useSearch', 'useParams', 'useNavigate', 'useLoaderData', 'useRouteContext'], property => ({
				message: 'Use getRouteApi(path) and its typed route hooks.',
				object: 'Route',
				property
			})),
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
			...Array.map(REACT_LEGACY_APIS, property => ({message: REACT_LEGACY_MESSAGE, object: 'React', property})),
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
			...Array.map(['setInterval', 'setTimeout'], property => ({
				message: 'Use Effect.sleep or Schedule.',
				object: 'window',
				property
			})),
			{message: 'Use HttpClient.', object: 'window', property: 'fetch'},
			{message: 'Use Clock.', object: 'window', property: 'performance'}
		],
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
		'import/no-unassigned-import': ['error', {allow: ['**/*.css']}],

		'jsx-a11y/alt-text': 'error',
		'jsx-a11y/anchor-ambiguous-text': 'error',
		'jsx-a11y/anchor-has-content': 'error',
		'jsx-a11y/anchor-is-valid': 'error',
		'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
		'jsx-a11y/aria-props': 'error',
		'jsx-a11y/aria-proptypes': 'error',
		'jsx-a11y/aria-role': ['error', {ignoreNonDOM: true}],
		'jsx-a11y/aria-unsupported-elements': 'error',
		'jsx-a11y/autocomplete-valid': 'error',
		'jsx-a11y/click-events-have-key-events': 'error',
		'jsx-a11y/control-has-associated-label': 'error',
		'jsx-a11y/heading-has-content': 'error',
		'jsx-a11y/html-has-lang': 'error',
		'jsx-a11y/iframe-has-title': 'error',
		'jsx-a11y/img-redundant-alt': 'error',
		'jsx-a11y/interactive-supports-focus': 'error',
		'jsx-a11y/label-has-associated-control': 'error',
		'jsx-a11y/lang': 'error',
		'jsx-a11y/media-has-caption': 'error',
		'jsx-a11y/mouse-events-have-key-events': 'error',
		'jsx-a11y/no-access-key': 'error',
		'jsx-a11y/no-aria-hidden-on-focusable': 'error',
		'jsx-a11y/no-autofocus': ['error', {ignoreNonDOM: true}],
		'jsx-a11y/no-distracting-elements': 'error',
		'jsx-a11y/no-interactive-element-to-noninteractive-role': 'error',
		'jsx-a11y/no-noninteractive-element-interactions': 'error',
		'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
		'jsx-a11y/no-noninteractive-tabindex': 'error',
		'jsx-a11y/no-redundant-roles': 'error',
		'jsx-a11y/no-static-element-interactions': 'error',
		'jsx-a11y/role-has-required-aria-props': 'error',
		'jsx-a11y/role-supports-aria-props': 'error',
		'jsx-a11y/scope': 'error',
		'jsx-a11y/tabindex-no-positive': 'error',

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

		'react/button-has-type': 'error',
		'react/capitalized-calls': 'error',
		'react/checked-requires-onchange-or-readonly': 'error',
		'react/error-boundaries': 'error',
		'react/exhaustive-deps': 'error',
		'react/globals': 'error',
		'react/hook-use-state': 'error',
		'react/hooks': 'error',
		'react/iframe-missing-sandbox': 'error',
		'react/immutability': 'error',
		'react/incompatible-library': 'error',
		'react/invariant': 'error',
		'react/jsx-boolean-value': ['error', 'never'],
		'react/jsx-curly-brace-presence': ['error', {children: 'never', propElementValues: 'always', props: 'never'}],
		'react/jsx-fragments': ['error', 'syntax'],
		'react/jsx-key': ['error', {checkFragmentShorthand: true, checkKeyMustBeforeSpread: true}],
		'react/jsx-no-comment-textnodes': 'error',
		'react/jsx-no-script-url': 'error',
		'react/jsx-no-target-blank': [
			'error',
			{allowReferrer: false, enforceDynamicLinks: 'always', forms: true, links: true, warnOnSpreadAttributes: true}
		],
		'react/jsx-no-useless-fragment': 'error',
		'react/jsx-pascal-case': [
			'error',
			{allowAllCaps: false, allowLeadingUnderscore: false, allowNamespace: false, ignore: []}
		],
		'react/jsx-props-no-spread-multi': 'error',
		'react/no-array-index-key': 'error',
		'react/no-children-prop': 'error',
		'react/no-clone-element': 'error',
		'react/no-danger': 'error',
		'react/no-danger-with-children': 'error',
		'react/no-namespace': 'error',
		'react/no-object-type-as-default-prop': 'error',
		'react/no-react-children': 'error',
		'react/no-this-in-sfc': 'error',
		'react/no-unescaped-entities': 'error',
		'react/no-unknown-property': ['error', {ignore: [], requireDataLowercase: true}],
		'react/purity': 'error',
		'react/refs': 'error',
		'react/rule-suppression': 'error',
		'react/rules-of-hooks': 'error',
		'react/self-closing-comp': 'error',
		'react/set-state-in-effect': 'error',
		'react/set-state-in-render': 'error',
		'react/static-components': 'error',
		'react/style-prop-object': 'error',
		'react/syntax': 'error',
		'react/todo': 'error',
		'react/unsupported-syntax': 'error',
		'react/void-dom-elements-no-children': 'error',

		'react-doctor/design-no-redundant-padding-axes': 'error',
		'react-doctor/design-no-redundant-size-axes': 'error',
		'react-doctor/effect-listener-cleanup-mismatch': 'error',
		'react-doctor/effect-needs-cleanup': 'error',
		'react-doctor/html-no-nested-interactive': 'error',
		'react-doctor/loading-action-preserves-trigger': 'error',
		'react-doctor/no-adjust-state-on-prop-change': 'error',
		'react-doctor/no-aria-invalid-without-description': 'error',
		'react-doctor/no-call-component-as-function': 'error',
		'react-doctor/no-controlled-input-value-without-state-update': 'error',
		'react-doctor/no-create-context-in-render': 'error',
		'react-doctor/no-create-object-url-without-revoke': 'error',
		'react-doctor/no-default-props': 'error',
		'react-doctor/no-derived-state': 'error',
		'react-doctor/no-derived-useState': 'error',
		'react-doctor/no-effect-event-in-deps': 'error',
		'react-doctor/no-effect-wrapper-discards-callback-cleanup-return': 'error',
		'react-doctor/no-enter-submit-without-ime-composition-guard': 'error',
		'react-doctor/no-event-handler': 'error',
		'react-doctor/no-flush-sync': 'error',
		'react-doctor/no-global-css-variable-animation': 'error',
		'react-doctor/no-gray-on-colored-background': 'error',
		'react-doctor/no-impure-state-updater': 'error',
		'react-doctor/no-inline-bounce-easing': 'error',
		'react-doctor/no-inline-exhaustive-style': 'error',
		'react-doctor/no-jsx-element-type': 'error',
		'react-doctor/no-large-animated-blur': 'error',
		'react-doctor/no-layout-property-animation': 'error',
		'react-doctor/no-layout-transition-inline': 'error',
		'react-doctor/no-many-boolean-props': 'error',
		'react-doctor/no-mutable-in-deps': 'error',
		'react-doctor/no-mutating-reducer-state': 'error',
		'react-doctor/no-nested-card-surface': 'error',
		'react-doctor/no-outline-none': 'error',
		'react-doctor/no-placeholder-only-field': 'error',
		'react-doctor/no-prop-callback-in-effect': 'error',
		'react-doctor/no-prop-callback-in-render': 'error',
		'react-doctor/no-prop-types': 'error',
		'react-doctor/no-random-key': 'error',
		'react-doctor/no-reduced-motion-content-removal': 'error',
		'react-doctor/no-render-in-render': 'error',
		'react-doctor/no-self-updating-effect': 'error',
		'react-doctor/no-stale-timer-ref': 'error',
		'react-doctor/no-transition-all': 'error',
		'react-doctor/no-uncontrolled-input': 'error',
		'react-doctor/no-ungated-tailwind-animation': 'error',
		'react-doctor/prefer-use-effect-event': 'error',
		'react-doctor/rendering-conditional-render': 'error',
		'react-doctor/rerender-functional-setstate': 'error',
		'react-doctor/rerender-lazy-ref-init': 'error',
		'react-doctor/rerender-lazy-state-init': 'error',
		'react-doctor/shadcn-dialog-content-requires-title': 'error',
		'react-doctor/shadcn-icon-button-requires-label': 'error',

		'shadcn/no-arbitrary-values': 'error',
		'shadcn/no-inline-styles': 'error',
		'shadcn/no-raw-colors': 'error',
		'shadcn/no-restyle': [
			'error',
			{
				allow: ['layout'],
				// The rule's `ui` setting does not reach the JS plugin here, so the primitives' modules are named directly.
				componentImports: ['^@deslop/components-web/ui(/|$)', '^#components/ui(/|$)'],
				// Hairline rows: Items touch, with a separator between them and no margin around it.
				contracts: [
					{allow: ['layout', 'gap-0'], pattern: '^ItemGroup$'},
					{allow: ['layout', 'my-0'], pattern: '^ItemSeparator$'}
				]
			}
		],
		'shadcn/no-unknown-classes': 'error',
		'shadcn/require-static-classes': 'error',

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
		// `navigate` is TanStack Router's: a navigation settles its own failures in the route's error boundary, and its promise only says the loaders finished. tsgolint matches it by name only.
		'typescript/no-floating-promises': [
			'error',
			{
				allowForKnownSafeCalls: [
					{from: 'file', name: 'navigate'},
					// Opening an external link hands control to the OS; its completion is not app state and has no in-app recovery.
					{from: 'package', name: 'openURL', package: 'react-native'}
				]
			}
		],
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
	},
	settings: {
		'jsx-a11y': {components: {Button: 'button', Input: 'input', Label: 'label', Textarea: 'textarea'}},
		react: {version: '19.0'},
		shadcn: {ui: ['@deslop/components-web/ui', '@dual/ui/components']}
	}
}

const plugin: Plugin = definePlugin({meta: {name: '@deslop/coding-standards'}, rules: RULES})

// oxlint-disable-next-line import/no-default-export -- Vite+ loads a lint plugin from its module's default export.
export default plugin
