import {Array, Record} from 'effect'

import type {OxlintConfig} from 'vite-plus/lint'
import {definePlugin} from 'vite-plus/lint/plugins'
import type {Plugin} from 'vite-plus/lint/plugins'

import {explicitEffectConcurrency} from '#rules/explicit-effect-concurrency.ts'
import {functionDeclaration} from '#rules/function-declaration.ts'
import {moduleConstant} from '#rules/module-constant.ts'
import {motionLimits} from '#rules/motion-limits.ts'
import {noAccumulatingCopy} from '#rules/no-accumulating-copy.ts'
import {noBarrelModule} from '#rules/no-barrel-module.ts'
import {noCompilerOptOut} from '#rules/no-compiler-opt-out.ts'
import {noComponentAtomAllocation} from '#rules/no-component-atom-allocation.ts'
import {noConstantFunction} from '#rules/no-constant-function.ts'
import {noDestructuredParameter} from '#rules/no-destructured-parameter.ts'
import {noDiscardedFailure} from '#rules/no-discarded-failure.ts'
import {noDoubleNullishCheck} from '#rules/no-double-nullish-check.ts'
import {noEffectGenCallback} from '#rules/no-effect-gen-callback.ts'
import {noEffectPropertyArrow} from '#rules/no-effect-property-arrow.ts'
import {noEmptyRecovery} from '#rules/no-empty-recovery.ts'
import {noErrorMessageAssertion} from '#rules/no-error-message-assertion.ts'
import {noErrorMessageControlFlow} from '#rules/no-error-message-control-flow.ts'
import {noFakeRefState} from '#rules/no-fake-ref-state.ts'
import {noFalliblePromise} from '#rules/no-fallible-promise.ts'
import {noFloatingDerivedType} from '#rules/no-floating-derived-type.ts'
import {noFocusedEffectTest} from '#rules/no-focused-effect-test.ts'
import {noGradient} from '#rules/no-gradient.ts'
import {noHandWrittenGuard} from '#rules/no-hand-written-guard.ts'
import {noInOperator} from '#rules/no-in-operator.ts'
import {noLet} from '#rules/no-let.ts'
import {noMultilineComment} from '#rules/no-multiline-comment.ts'
import {noNativeControl} from '#rules/no-native-control.ts'
import {noNativeEmptinessCheck} from '#rules/no-native-emptiness-check.ts'
import {noNativeMethodCall} from '#rules/no-native-method-call.ts'
import {noOptionValueAccess} from '#rules/no-option-value-access.ts'
import {noPipeMethod} from '#rules/no-pipe-method.ts'
import {noPropertyAlias} from '#rules/no-property-alias.ts'
import {noRedundantStateType} from '#rules/no-redundant-state-type.ts'
import {noRedundantUseRefNullType} from '#rules/no-redundant-use-ref-null-type.ts'
import {noRedundantVariableAnnotation} from '#rules/no-redundant-variable-annotation.ts'
import {noReinventedSchema} from '#rules/no-reinvented-schema.ts'
import {noRenamedImport} from '#rules/no-renamed-import.ts'
import {noReturnType} from '#rules/no-return-type.ts'
import {noSingleUseValue} from '#rules/no-single-use-value.ts'
import {noStoredJsx} from '#rules/no-stored-jsx.ts'
import {noStoredSchemaOperation} from '#rules/no-stored-schema-operation.ts'
import {noSwitchStatement} from '#rules/no-switch-statement.ts'
import {noTernary} from '#rules/no-ternary.ts'
import {noTrivialIndirection} from '#rules/no-trivial-indirection.ts'
import {noTypeFromValue} from '#rules/no-type-from-value.ts'
import {noTypeof} from '#rules/no-typeof.ts'
import {noUnexplainedDisable} from '#rules/no-unexplained-disable.ts'
import {noUnvalidatedJsonDecode} from '#rules/no-unvalidated-json-decode.ts'
import {preferEffectCountBy} from '#rules/prefer-effect-count-by.ts'
import {preserveErrorCause} from '#rules/preserve-error-cause.ts'
import {requireUnicodeRegexp} from '#rules/require-unicode-regexp.ts'
import {schemaTypePair} from '#rules/schema-type-pair.ts'

const REACT_LEGACY_APIS = ['Component', 'PureComponent', 'createRef', 'forwardRef', 'memo', 'useCallback', 'useMemo']
const REACT_LEGACY_MESSAGE = 'Use React 19 function components with refs as props; React Compiler owns memoization.'
const MAP_MESSAGE =
	'Use HashMap, or MutableHashMap for local mutation; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.'
const REACT_HOOKS = [
	'use',
	'useActionState',
	'useContext',
	'useDebugValue',
	'useDeferredValue',
	'useEffect',
	'useEffectEvent',
	'useId',
	'useImperativeHandle',
	'useInsertionEffect',
	'useLayoutEffect',
	'useOptimistic',
	'useReducer',
	'useRef',
	'useState',
	'useSyncExternalStore',
	'useTransition'
]
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

const RULES = {
	'explicit-effect-concurrency': explicitEffectConcurrency,
	'function-declaration': functionDeclaration,
	'module-constant': moduleConstant,
	'motion-limits': motionLimits,
	'no-accumulating-copy': noAccumulatingCopy,
	'no-barrel-module': noBarrelModule,
	'no-compiler-opt-out': noCompilerOptOut,
	'no-component-atom-allocation': noComponentAtomAllocation,
	'no-constant-function': noConstantFunction,
	'no-destructured-parameter': noDestructuredParameter,
	'no-discarded-failure': noDiscardedFailure,
	'no-double-nullish-check': noDoubleNullishCheck,
	'no-effect-gen-callback': noEffectGenCallback,
	'no-effect-property-arrow': noEffectPropertyArrow,
	'no-empty-recovery': noEmptyRecovery,
	'no-error-message-assertion': noErrorMessageAssertion,
	'no-error-message-control-flow': noErrorMessageControlFlow,
	'no-fake-ref-state': noFakeRefState,
	'no-fallible-promise': noFalliblePromise,
	'no-floating-derived-type': noFloatingDerivedType,
	'no-focused-effect-test': noFocusedEffectTest,
	'no-gradient': noGradient,
	'no-hand-written-guard': noHandWrittenGuard,
	'no-in-operator': noInOperator,
	'no-let': noLet,
	'no-multiline-comment': noMultilineComment,
	'no-native-control': noNativeControl,
	'no-native-emptiness-check': noNativeEmptinessCheck,
	'no-native-method-call': noNativeMethodCall,
	'no-option-value-access': noOptionValueAccess,
	'no-pipe-method': noPipeMethod,
	'no-property-alias': noPropertyAlias,
	'no-redundant-state-type': noRedundantStateType,
	'no-redundant-use-ref-null-type': noRedundantUseRefNullType,
	'no-redundant-variable-annotation': noRedundantVariableAnnotation,
	'no-reinvented-schema': noReinventedSchema,
	'no-renamed-import': noRenamedImport,
	'no-return-type': noReturnType,
	'no-single-use-value': noSingleUseValue,
	'no-stored-jsx': noStoredJsx,
	'no-stored-schema-operation': noStoredSchemaOperation,
	'no-switch-statement': noSwitchStatement,
	'no-ternary': noTernary,
	'no-trivial-indirection': noTrivialIndirection,
	'no-type-from-value': noTypeFromValue,
	'no-typeof': noTypeof,
	'no-unexplained-disable': noUnexplainedDisable,
	'no-unvalidated-json-decode': noUnvalidatedJsonDecode,
	'prefer-effect-count-by': preferEffectCountBy,
	'preserve-error-cause': preserveErrorCause,
	'require-unicode-regexp': requireUnicodeRegexp,
	'schema-type-pair': schemaTypePair
}

export const lint: OxlintConfig = {
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
		{files: ['**/*.test.ts'], rules: {'@deslop/coding-standards/no-discarded-failure': 'off'}},
		{files: ['**/*.tsx'], rules: {'eslint/require-await': 'error', 'unicorn/no-null': 'off'}}
	],
	plugins: ['eslint', 'typescript', 'oxc', 'import', 'jsx-a11y', 'react', 'unicorn', 'vitest'],
	rules: {
		...Record.mapEntries(RULES, (_, name) => [`@deslop/coding-standards/${name}`, 'error' as const]),

		// JavaScript
		'eslint/arrow-body-style': ['error', 'as-needed'],
		'eslint/constructor-super': 'error',
		'eslint/curly': ['error', 'multi-line', 'consistent'],
		'eslint/eqeqeq': 'error',
		'eslint/for-direction': 'error',
		'eslint/func-names': ['error', 'as-needed', {generators: 'never'}],
		'eslint/no-alert': 'error',
		'eslint/no-caller': 'error',
		'eslint/no-compare-neg-zero': 'error',
		'eslint/no-cond-assign': 'error',
		'eslint/no-constant-binary-expression': 'error',
		'eslint/no-constant-condition': 'error',
		'eslint/no-constructor-return': 'error',
		'eslint/no-continue': 'error',
		'eslint/no-control-regex': 'error',
		'eslint/no-debugger': 'error',
		'eslint/no-delete-var': 'error',
		'eslint/no-dupe-else-if': 'error',
		'eslint/no-else-return': 'error',
		'eslint/no-empty': 'error',
		'eslint/no-empty-character-class': 'error',
		'eslint/no-empty-function': ['error', {allow: ['arrowFunctions']}],
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
		'eslint/no-lonely-if': 'error',
		'eslint/no-loss-of-precision': 'error',
		'eslint/no-misleading-character-class': 'error',
		'eslint/no-multi-assign': 'error',
		'eslint/no-negated-condition': 'error',
		'eslint/no-new': 'error',
		'eslint/no-new-func': 'error',
		'eslint/no-nonoctal-decimal-escape': 'error',
		'eslint/no-param-reassign': ['error', {props: true}],
		'eslint/no-plusplus': 'error',
		'eslint/no-proto': 'error',
		'eslint/no-restricted-exports': ['error', {restrictedNamedExportsPattern: 'Live$'}],
		'eslint/no-restricted-globals': [
			'error',
			{message: 'Interrupt through Effect: a fiber, Effect.timeout, or a Scope.', name: 'AbortController'},
			{message: "Import Array from 'effect'.", name: 'Array'},
			{message: "Import Boolean from 'effect'.", name: 'Boolean'},
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
		],
		'eslint/no-restricted-imports': [
			'error',
			{
				paths: [
					{importNames: REACT_LEGACY_APIS, message: REACT_LEGACY_MESSAGE, name: 'react'},
					{message: 'Read and write data through Effect Atom.', name: '@tanstack/react-query'},
					...Array.flatMap(['vitest', 'vite-plus/test', '@effect/vitest'], name => [
						{importNames: ['vi'], message: 'A Layer is the seam; never use vi.', name},
						{importNames: ['expect'], message: 'Use assert from @effect/vitest.', name}
					]),
					{importNames: RUNNERS, message: RUN_MESSAGE, name: 'effect/Effect'}
				],
				patterns: [
					{message: 'Prove a screen in the browser; no UI tests.', regex: '^(?:@testing-library/|jsdom$|happy-dom$)'},
					{message: 'Use public package exports.', regex: '^@[^/]+/[^/]+/(?:src|lib)(?:/|$)'},
					{
						message: 'Use glob from the FileSystem service.',
						regex: '^(?:glob|fast-glob|globby|minimatch|picomatch|micromatch)(?:/|$)'
					},
					{message: 'Use Schema.', regex: '^(?:zod|valibot|yup|io-ts)(?:/|$)'},
					{message: 'Use Csv from effect/encoding.', regex: '^(?:papaparse|csv-parse|csv-stringify)(?:/|$)'},
					{message: 'Use Yaml from effect/encoding.', regex: '^(?:yaml|js-yaml)(?:/|$)'},
					{message: 'Use Toml from effect/encoding.', regex: '^(?:smol-toml|@iarna/toml|toml)(?:/|$)'},
					{message: 'Use Ini from effect/encoding.', regex: '^ini(?:/|$)'},
					{message: 'Use Xml from effect/encoding.', regex: '^(?:fast-xml-parser|xml2js|sax)(?:/|$)'},
					{message: 'Use Zip or Tar from effect/encoding.', regex: '^(?:jszip|fflate|adm-zip|tar|tar-stream)(?:/|$)'},
					{message: 'Use effect/cli.', regex: '^(?:commander|yargs)(?:/|$)'},
					{message: 'Use uuidV4 from the SecureRandom service in effect/crypto.', regex: '^uuid(?:/|$)'},
					{message: 'Use HttpClient.', regex: '^(?:axios|node-fetch)(?:/|$)'},
					{message: 'Use Config.', regex: '^dotenv(?:/|$)'},
					{message: 'Use ChildProcess from effect/process.', regex: '^execa(?:/|$)'},
					{message: 'Use the concurrency option of Effect.all or Effect.forEach.', regex: '^p-limit(?:/|$)'}
				]
			}
		],
		'eslint/no-restricted-properties': [
			'error',
			{
				message: 'Decode JSON through Schema.fromJsonString with the protocol schema.',
				object: 'JSON',
				property: 'parse'
			},
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
			...Array.map(REACT_HOOKS, property => ({
				message: `Import ${property} by name from react.`,
				object: 'React',
				property
			})),
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
					'atob',
					'btoa',
					'cancelAnimationFrame',
					'cancelIdleCallback',
					'dispatchEvent',
					'localStorage',
					'navigator',
					'queueMicrotask',
					'removeEventListener',
					'requestAnimationFrame',
					'requestIdleCallback',
					'sessionStorage',
					'structuredClone'
				],
				property => ({message: `Use the bare ${property} global.`, object: 'window', property})
			),
			...Array.map(['clearInterval', 'clearTimeout', 'setInterval', 'setTimeout'], property => ({
				message: 'Use Effect.sleep or Schedule.',
				object: 'window',
				property
			})),
			{
				message: 'Interrupt through Effect: a fiber, Effect.timeout, or a Scope.',
				object: 'window',
				property: 'AbortController'
			},
			{message: 'Use the effect/crypto services.', object: 'window', property: 'crypto'},
			{message: 'Use HttpClient.', object: 'window', property: 'fetch'},
			{message: 'Use Clock.', object: 'window', property: 'performance'}
		],
		'eslint/no-return-assign': 'error',
		'eslint/no-self-assign': 'error',
		'eslint/no-self-compare': 'error',
		'eslint/no-sequences': 'error',
		'eslint/no-shadow': [
			'error',
			{allow: ['Array', 'Boolean', 'Console', 'Effect', 'HashMap', 'Number', 'Option', 'Schema', 'String']}
		],
		'eslint/no-shadow-restricted-names': 'error',
		'eslint/no-sparse-arrays': 'error',
		'eslint/no-throw-literal': 'error',
		'eslint/no-unexpected-multiline': 'error',
		'eslint/no-unmodified-loop-condition': 'error',
		'eslint/no-unreachable-loop': 'error',
		'eslint/no-unsafe-finally': 'error',
		'eslint/no-unsafe-optional-chaining': ['error', {disallowArithmeticOperators: true}],
		'eslint/no-unused-expressions': 'error',
		'eslint/no-use-before-define': ['error', {classes: true, functions: true, typedefs: false, variables: true}],
		'eslint/no-useless-backreference': 'error',
		'eslint/no-useless-call': 'error',
		'eslint/no-useless-catch': 'error',
		'eslint/no-useless-computed-key': 'error',
		'eslint/no-useless-concat': 'error',
		'eslint/no-useless-constructor': 'error',
		'eslint/no-useless-escape': 'error',
		'eslint/no-useless-rename': 'error',
		'eslint/no-useless-return': 'error',
		'eslint/no-var': 'error',
		'eslint/no-void': 'error',
		'eslint/no-warning-comments': 'error',
		'eslint/no-with': 'error',
		'eslint/object-shorthand': 'error',
		'eslint/prefer-arrow-callback': 'error',
		'eslint/prefer-const': ['error', {destructuring: 'all'}],
		'eslint/prefer-template': 'error',
		'eslint/preserve-caught-error': 'error',
		'eslint/require-yield': 'error',
		'eslint/sort-keys': ['error', 'asc', {allowLineSeparatedGroups: true, natural: true}],
		'eslint/valid-typeof': 'error',
		'eslint/yoda': 'error',

		// Imports
		'import/first': 'error',
		'import/newline-after-import': 'error',
		'import/no-absolute-path': 'error',
		'import/no-commonjs': ['error', {allowConditionalRequire: false}],
		'import/no-default-export': 'error',
		'import/no-duplicates': 'error',
		'import/no-named-as-default': 'error',
		'import/no-named-as-default-member': 'error',
		'import/no-namespace': ['error', {ignore: ['[!#./]*', '[!#./]*/**']}],
		'import/no-relative-parent-imports': 'error',
		'import/no-self-import': 'error',
		'import/no-unassigned-import': ['error', {allow: ['**/*.css']}],

		// Accessibility
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

		// Oxc
		'oxc/approx-constant': 'error',
		'oxc/bad-array-method-on-arguments': 'error',
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

		// React and React Compiler
		'react/button-has-type': 'error',
		'react/capitalized-calls': 'error',
		'react/checked-requires-onchange-or-readonly': 'error',
		'react/error-boundaries': 'error',
		'react/exhaustive-deps': 'error',
		'react/exhaustive-effect-dependencies': 'error',
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
		'react/jsx-key': 'error',
		'react/jsx-no-comment-textnodes': 'error',
		'react/jsx-no-script-url': 'error',
		'react/jsx-no-target-blank': 'error',
		'react/jsx-no-useless-fragment': 'error',
		'react/jsx-props-no-spread-multi': 'error',
		'react/no-array-index-key': 'error',
		'react/no-children-prop': 'error',
		'react/no-clone-element': 'error',
		'react/no-danger': 'error',
		'react/no-danger-with-children': 'error',
		'react/no-namespace': 'error',
		'react/no-object-type-as-default-prop': 'error',
		'react/no-react-children': 'error',
		'react/no-unknown-property': 'error',
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

		// React Doctor
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

		// shadcn
		'shadcn/no-arbitrary-values': 'error',
		'shadcn/no-inline-styles': 'error',
		'shadcn/no-raw-colors': 'error',
		'shadcn/no-restyle': ['error', {allow: ['layout']}],
		'shadcn/no-unknown-classes': 'error',
		'shadcn/require-static-classes': 'error',

		// TypeScript syntax; no type-aware rules
		'typescript/ban-ts-comment': ['error', {'ts-nocheck': true}],
		'typescript/consistent-generic-constructors': 'error',
		'typescript/consistent-indexed-object-style': 'error',
		'typescript/consistent-type-assertions': [
			'error',
			{arrayLiteralTypeAssertions: 'never', assertionStyle: 'never', objectLiteralTypeAssertions: 'never'}
		],
		'typescript/consistent-type-definitions': ['error', 'type'],
		'typescript/consistent-type-imports': ['error', {fixStyle: 'separate-type-imports', prefer: 'type-imports'}],
		'typescript/method-signature-style': 'error',
		'typescript/no-dynamic-delete': 'error',
		'typescript/no-empty-object-type': 'error',
		'typescript/no-explicit-any': 'error',
		'typescript/no-extraneous-class': 'error',
		'typescript/no-import-type-side-effects': 'error',
		'typescript/no-inferrable-types': 'error',
		'typescript/no-misused-new': 'error',
		'typescript/no-namespace': ['error', {allowDeclarations: true}],
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
		'typescript/no-this-alias': 'error',
		'typescript/no-unnecessary-type-constraint': 'error',
		'typescript/no-unsafe-declaration-merging': 'error',
		'typescript/no-unsafe-function-type': 'error',
		'typescript/no-wrapper-object-types': 'error',
		'typescript/prefer-as-const': 'error',
		'typescript/prefer-function-type': 'error',
		'typescript/triple-slash-reference': 'error',
		'typescript/unified-signatures': 'error',

		// Unicorn
		'unicorn/consistent-function-scoping': 'error',
		'unicorn/filename-case': 'error',
		'unicorn/no-abusive-eslint-disable': 'error',
		'unicorn/no-accessor-recursion': 'error',
		'unicorn/no-empty-file': 'error',
		'unicorn/no-immediate-mutation': 'error',
		'unicorn/no-instanceof-builtins': 'error',
		'unicorn/no-invalid-fetch-options': 'error',
		'unicorn/no-invalid-remove-event-listener': 'error',
		'unicorn/no-null': 'error',
		'unicorn/no-object-as-default-parameter': 'error',
		'unicorn/no-process-exit': 'error',
		'unicorn/no-thenable': 'error',
		'unicorn/no-unnecessary-await': 'error',
		'unicorn/no-useless-fallback-in-spread': 'error',
		'unicorn/no-useless-spread': 'error',
		'unicorn/numeric-separators-style': 'error',
		'unicorn/prefer-add-event-listener': 'error',
		'unicorn/prefer-bigint-literals': 'error',
		'unicorn/prefer-optional-catch-binding': 'error',
		// The compiler's preferEffectString moves native string methods to Effect's String, whose replace with a global pattern this still turns into replaceAll.
		'unicorn/prefer-string-replace-all': 'error',
		'unicorn/require-module-specifiers': 'error',
		'unicorn/require-post-message-target-origin': 'error',

		// Tests
		'vitest/expect-expect': 'error',
		'vitest/no-commented-out-tests': 'error',
		'vitest/no-conditional-tests': 'error',
		'vitest/no-disabled-tests': 'error',
		'vitest/no-focused-tests': 'error',
		'vitest/no-identical-title': 'error',
		'vitest/valid-describe-callback': 'error',
		'vitest/valid-title': 'error',
		'vitest/warn-todo': 'error',

		// Vite+
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
