import {definePlugin} from '@oxlint/plugins'
import {defineConfig} from 'oxlint'

import {noArrayWrapTernary} from './rules/no-array-wrap-ternary.ts'
import {noConstantFunction} from './rules/no-constant-function.ts'
import {noDeepPipe} from './rules/no-deep-pipe.ts'
import {noErrorMessageAssertion} from './rules/no-error-message-assertion.ts'
import {noFakeRefState} from './rules/no-fake-ref-state.ts'
import {noNativeMethodCall} from './rules/no-native-method-call.ts'
import {noReadonlyTypeSyntax} from './rules/no-readonly-type-syntax.ts'
import {noRedundantUseRefNullType} from './rules/no-redundant-use-ref-null-type.ts'
import {noStoredSchemaOperation} from './rules/no-stored-schema-operation.ts'
import {noTrivialIndirection} from './rules/no-trivial-indirection.ts'
import {noTypeof} from './rules/no-typeof.ts'
import {noUndestructuredUseState} from './rules/no-undestructured-use-state.ts'
import {noUnexplainedDisable} from './rules/no-unexplained-disable.ts'
import {noUnvalidatedJsonDecode} from './rules/no-unvalidated-json-decode.ts'
import {schemaTypePair} from './rules/schema-type-pair.ts'

export const oxlint = defineConfig({
	categories: {
		correctness: 'off',
		nursery: 'off',
		pedantic: 'off',
		perf: 'off',
		restriction: 'off',
		style: 'off',
		suspicious: 'off'
	},
	ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/*.gen.ts'],
	jsPlugins: [
		{name: '@deslop/workflow', specifier: '@deslop/workflow'},
		{name: 'react-doctor', specifier: 'oxlint-plugin-react-doctor'}
	],
	options: {denyWarnings: true, reportUnusedDisableDirectives: 'deny', typeAware: true, typeCheck: true},
	overrides: [
		{files: ['**/*.config.ts', '**/main.*'], rules: {'import/no-default-export': 'off', 'sort-keys': 'off'}},
		{files: ['**/src/oxlint.ts'], rules: {'import/no-default-export': 'off'}},
		{files: ['**/*.ts'], rules: {'react/rules-of-hooks': 'off'}},
		{
			files: ['**/*.tsx'],
			rules: {
				'effecttsgo/async-function': 'off',
				'typescript/require-await': 'error',
				'typescript/strict-void-return': 'off',
				'unicorn/no-null': 'off'
			}
		}
	],
	plugins: ['effecttsgo', 'eslint', 'typescript', 'oxc', 'import', 'react', 'unicorn'],
	rules: {
		// Effect and React forms that maintained rules cannot express.
		'@deslop/workflow/no-array-wrap-ternary': 'error',
		'@deslop/workflow/no-constant-function': 'error',
		'@deslop/workflow/no-deep-pipe': 'error',
		'@deslop/workflow/no-error-message-assertion': 'error',
		'@deslop/workflow/no-fake-ref-state': 'error',
		'@deslop/workflow/no-native-method-call': 'error',
		'@deslop/workflow/no-readonly-type-syntax': 'error',
		'@deslop/workflow/no-redundant-use-ref-null-type': 'error',
		'@deslop/workflow/no-stored-schema-operation': 'error',
		'@deslop/workflow/no-trivial-indirection': 'error',
		'@deslop/workflow/no-typeof': 'error',
		'@deslop/workflow/no-undestructured-use-state': 'error',
		'@deslop/workflow/no-unexplained-disable': 'error',
		'@deslop/workflow/no-unvalidated-json-decode': 'error',
		'@deslop/workflow/schema-type-pair': 'error',

		// Effect owns native capabilities in and outside generators.
		'effecttsgo/crypto-random-uuid': 'error',
		'effecttsgo/crypto-random-uuid-in-effect': 'error',
		'effecttsgo/global-console': 'error',
		'effecttsgo/global-console-in-effect': 'error',
		'effecttsgo/global-date': 'error',
		'effecttsgo/global-date-in-effect': 'error',
		'effecttsgo/global-fetch': 'error',
		'effecttsgo/global-fetch-in-effect': 'error',
		'effecttsgo/global-random': 'error',
		'effecttsgo/global-random-in-effect': 'error',
		'effecttsgo/global-timers': 'error',
		'effecttsgo/global-timers-in-effect': 'error',
		'effecttsgo/node-builtin-import': 'error',
		'effecttsgo/prefer-schema-over-json': 'error',
		'effecttsgo/process-env': 'error',
		'effecttsgo/process-env-in-effect': 'error',

		// Effect programs retain work, requirements, and one direct composition path.
		'effecttsgo/async-function': 'error',
		'effecttsgo/duplicate-package': 'error',
		'effecttsgo/effect-do-notation': 'error',
		'effecttsgo/effect-fn-iife': 'error',
		'effecttsgo/effect-fn-implicit-any': 'error',
		'effecttsgo/effect-fn-opportunity': 'error',
		'effecttsgo/effect-gen-uses-adapter': 'error',
		'effecttsgo/effect-in-failure': 'error',
		'effecttsgo/effect-in-void-success': 'error',
		'effecttsgo/effect-map-flatten': 'error',
		'effecttsgo/effect-map-void': 'error',
		'effecttsgo/effect-succeed-with-void': 'error',
		'effecttsgo/flat-map-to-map': 'error',
		'effecttsgo/floating-effect': 'error',
		'effecttsgo/floating-effect-in-vitest': 'error',
		'effecttsgo/layer-merge-all-with-dependencies': 'error',
		'effecttsgo/lazy-effect': 'error',
		'effecttsgo/lazy-promise-in-effect-sync': 'error',
		'effecttsgo/leaking-requirements': 'error',
		'effecttsgo/missing-effect-context': 'error',
		'effecttsgo/missing-layer-context': 'error',
		'effecttsgo/missing-return-yield-star': 'error',
		'effecttsgo/missing-star-in-yield-effect-gen': 'error',
		'effecttsgo/multiple-effect-provide': 'error',
		'effecttsgo/nested-effect-gen-yield': 'error',
		'effecttsgo/outdated-api': 'error',
		'effecttsgo/promise-in-effect-success': 'error',
		'effecttsgo/return-effect-in-gen': 'error',
		'effecttsgo/run-effect-inside-effect': 'error',
		'effecttsgo/strict-effect-provide': 'error',
		'effecttsgo/sync-to-succeed': 'error',
		'effecttsgo/try-catch-in-effect-gen': 'error',
		'effecttsgo/unnecessary-effect-gen': 'error',
		'effecttsgo/unnecessary-fail-yieldable-error': 'error',
		'effecttsgo/unnecessary-pipe': 'error',
		'effecttsgo/unnecessary-pipe-chain': 'error',
		'effecttsgo/unsafe-effect-type-assertion': 'error',

		// Failures remain typed and recovery remains direct.
		'effecttsgo/any-unknown-in-error-context': 'error',
		'effecttsgo/catch-all-to-map-error': 'error',
		'effecttsgo/catch-chain-to-first-success-of': 'error',
		'effecttsgo/catch-tag-to-catch-reason': 'error',
		'effecttsgo/catch-to-ignore': 'error',
		'effecttsgo/catch-to-or-else-succeed': 'error',
		'effecttsgo/catch-unfailable-effect': 'error',
		'effecttsgo/missing-effect-error': 'error',
		'effecttsgo/multiple-catch-tag': 'error',
		'effecttsgo/redundant-map-error': 'error',
		'effecttsgo/redundant-or-die': 'error',
		'effecttsgo/unknown-in-effect-catch': 'error',

		// Services and schemas use current, sound class and identity forms.
		'effecttsgo/class-self-mismatch': 'error',
		'effecttsgo/deterministic-keys': 'error',
		'effecttsgo/generic-effect-services': 'error',
		'effecttsgo/instance-of-schema': 'error',
		'effecttsgo/new-schema-class': 'error',
		'effecttsgo/overridden-schema-constructor': 'error',
		'effecttsgo/prefer-schema-type-property': 'error',
		'effecttsgo/prefer-typed-schema-decoder': 'error',
		'effecttsgo/schema-literal-non-finite': 'error',
		'effecttsgo/schema-number': 'error',
		'effecttsgo/schema-struct-with-tag': 'error',
		'effecttsgo/service-not-as-class': 'error',
		'effecttsgo/unnecessary-typeof-type': 'error',

		// TypeScript type shape
		'@typescript-eslint/array-type': ['error', {default: 'array'}],
		'@typescript-eslint/consistent-generic-constructors': 'error',
		'@typescript-eslint/consistent-indexed-object-style': 'error',
		'@typescript-eslint/consistent-type-assertions': [
			'error',
			{arrayLiteralTypeAssertions: 'never', assertionStyle: 'never', objectLiteralTypeAssertions: 'never'}
		],
		'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
		'@typescript-eslint/consistent-type-exports': 'error',
		'@typescript-eslint/consistent-type-imports': [
			'error',
			{fixStyle: 'separate-type-imports', prefer: 'type-imports'}
		],
		'@typescript-eslint/method-signature-style': 'error',
		'@typescript-eslint/prefer-function-type': 'error',

		// TypeScript correctness
		'@typescript-eslint/no-array-delete': 'error',
		'@typescript-eslint/no-base-to-string': 'error',
		'@typescript-eslint/no-confusing-void-expression': 'error',
		'@typescript-eslint/no-deprecated': 'error',
		'@typescript-eslint/no-duplicate-type-constituents': 'error',
		'@typescript-eslint/no-dynamic-delete': 'error',
		'@typescript-eslint/no-empty-object-type': 'error',
		'@typescript-eslint/no-explicit-any': 'error',
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/no-import-type-side-effects': 'error',
		'@typescript-eslint/no-inferrable-types': 'error',
		'@typescript-eslint/no-invalid-void-type': 'error',
		'@typescript-eslint/no-misused-promises': ['error', {checksVoidReturn: false}],
		'@typescript-eslint/no-misused-spread': 'error',
		'@typescript-eslint/no-namespace': ['error', {allowDeclarations: true}],
		'@typescript-eslint/no-non-null-assertion': 'error',
		'@typescript-eslint/no-redundant-type-constituents': 'error',
		'@typescript-eslint/no-require-imports': 'error',
		'@typescript-eslint/no-this-alias': 'error',
		'@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
		'@typescript-eslint/no-unnecessary-condition': 'error',
		'@typescript-eslint/no-unnecessary-template-expression': 'error',
		'@typescript-eslint/no-unnecessary-type-arguments': 'error',
		'@typescript-eslint/no-unnecessary-type-constraint': 'error',
		'@typescript-eslint/no-unnecessary-type-conversion': 'error',
		'@typescript-eslint/no-unnecessary-type-parameters': 'error',
		'@typescript-eslint/no-unsafe-argument': 'error',
		'@typescript-eslint/no-unsafe-assignment': 'error',
		'@typescript-eslint/no-unsafe-call': 'error',
		'@typescript-eslint/no-unsafe-declaration-merging': 'error',
		'@typescript-eslint/no-unsafe-function-type': 'error',
		'@typescript-eslint/no-unsafe-member-access': 'error',
		'@typescript-eslint/no-unsafe-return': 'error',
		'@typescript-eslint/no-useless-empty-export': 'error',
		'@typescript-eslint/unified-signatures': 'error',
		'typescript/await-thenable': 'error',
		'typescript/no-unnecessary-qualifier': 'error',
		'typescript/no-wrapper-object-types': 'error',
		'typescript/unbound-method': 'error',

		// TypeScript preferences
		'@typescript-eslint/prefer-as-const': 'error',
		'@typescript-eslint/prefer-nullish-coalescing': 'error',
		'@typescript-eslint/prefer-optional-chain': 'error',

		// TypeScript expression boundaries
		'@typescript-eslint/restrict-plus-operands': 'error',
		'@typescript-eslint/restrict-template-expressions': 'error',
		'@typescript-eslint/strict-boolean-expressions': 'error',
		'@typescript-eslint/strict-void-return': 'error',

		// JavaScript style
		'arrow-body-style': ['error', 'as-needed'],
		curly: ['error', 'multi-line', 'consistent'],
		eqeqeq: 'error',
		'func-names': ['error', 'as-needed', {generators: 'never'}],
		'func-style': ['error', 'declaration'],

		// Imports
		'import/newline-after-import': 'error',
		'import/no-absolute-path': 'error',
		'import/no-commonjs': 'error',
		'import/no-default-export': 'error',
		'import/no-duplicates': 'error',
		'import/no-empty-named-blocks': 'error',
		'import/no-mutable-exports': 'error',
		'import/no-namespace': ['error', {ignore: ['[!#./]*', '[!#./]*/**']}],
		'import/no-relative-parent-imports': 'error',
		'import/no-self-import': 'error',
		'no-restricted-imports': [
			'error',
			{
				paths: [
					{
						importNames: ['Component', 'PureComponent', 'createRef', 'forwardRef', 'memo', 'useCallback', 'useMemo'],
						message: 'Use React 19 function components and let React Compiler own memoization.',
						name: 'react'
					},
					{importNames: ['vi'], message: 'A Layer is the seam; never use vi.', name: 'vitest'},
					{importNames: ['vi'], message: 'A Layer is the seam; never use vi.', name: '@effect/vitest'}
				],
				patterns: [
					{message: 'Use public package exports.', regex: '^@[^/]+/[^/]+/(?:src|lib)(?:/|$)'},
					{message: 'Use glob from the FileSystem service.', regex: '^glob(?:/|$)'},
					{message: 'Use effect/unstable/cli.', regex: '^(?:commander|yargs)(?:/|$)'},
					{message: 'Use randomUUIDv4 from the Crypto service.', regex: '^uuid(?:/|$)'},
					{message: 'Use HttpClient.', regex: '^(?:axios|node-fetch)(?:/|$)'},
					{message: 'Use Config.', regex: '^dotenv(?:/|$)'},
					{message: 'Use ChildProcess from effect/unstable/process.', regex: '^execa(?:/|$)'},
					{message: 'Use the concurrency option of Effect.all or Effect.forEach.', regex: '^p-limit(?:/|$)'}
				]
			}
		],

		// JavaScript correctness
		'max-nested-callbacks': ['error', 6],
		'no-cond-assign': 'error',
		'no-continue': 'error',
		'no-control-regex': 'error',
		'no-debugger': 'error',
		'no-else-return': 'error',
		'no-empty-function': ['error', {allow: ['arrowFunctions']}],
		'no-eval': 'error',
		'no-extend-native': 'error',
		'no-extra-bind': 'error',
		'no-extra-boolean-cast': 'error',
		'no-implied-eval': 'error',
		'no-invalid-regexp': 'error',
		'no-iterator': 'error',
		'no-lonely-if': 'error',
		'no-misleading-character-class': 'error',
		'no-multi-assign': 'error',
		'no-negated-condition': 'error',
		'no-nested-ternary': 'error',
		'no-new': 'error',
		'no-param-reassign': ['error', {props: true}],
		'no-plusplus': 'error',
		'no-proto': 'error',
		'no-restricted-exports': ['error', {restrictedNamedExportsPattern: 'Live$'}],
		'no-restricted-globals': [
			'error',
			'AbortController',
			'Array',
			'Boolean',
			'Error',
			{
				message:
					'Use MutableHashMap; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.',
				name: 'Map'
			},
			'Number',
			'Object',
			'Promise',
			'Reflect',
			{
				message:
					'Use MutableHashSet; for identity keys, wrap objects the code owns in Equal.byReferenceUnsafe, which marks them reference-compared globally.',
				name: 'Set'
			},
			'String',
			'global',
			'globalThis'
		],
		'no-restricted-properties': [
			'error',
			{message: 'Use standalone pipe.', property: 'pipe'},
			{allowObjects: ['Predicate'], message: 'Use Predicate.hasProperty.', property: 'hasOwnProperty'},
			{message: 'Use an owned runtime.', object: 'Effect', property: 'runFork'},
			{message: 'Use an owned runtime.', object: 'Effect', property: 'runPromise'},
			{message: 'Use an owned runtime.', object: 'Effect', property: 'runPromiseExit'},
			{message: 'Use an owned runtime.', object: 'Effect', property: 'runSync'},
			{message: 'Use an owned runtime.', object: 'Effect', property: 'runSyncExit'},
			{message: 'Use Number.max.', object: 'Math', property: 'max'},
			{message: 'Use Number.min.', object: 'Math', property: 'min'},
			{message: 'Use Number.round.', object: 'Math', property: 'round'},
			{message: 'React Compiler owns memoization.', object: 'React', property: 'memo'},
			{message: 'React Compiler owns memoization.', object: 'React', property: 'useMemo'},
			{message: 'React Compiler owns memoization.', object: 'React', property: 'useCallback'},
			{message: 'Pass refs as props in React 19.', object: 'React', property: 'forwardRef'},
			{message: 'Use useRef in function components.', object: 'React', property: 'createRef'},
			{message: 'Use function components.', object: 'React', property: 'Component'},
			{message: 'Use function components.', object: 'React', property: 'PureComponent'},
			{message: 'Use Schema.Struct.', object: 'Schema', property: 'Class'},
			{message: 'Use a branded schema.', object: 'Schema', property: 'Opaque'},
			{message: 'Use Schema.Struct.', object: 'Schema', property: 'TaggedClass'},
			{message: 'Use schema-backed data.', object: 'Data', property: 'Class'},
			{message: 'Use Schema.TaggedError.', object: 'Data', property: 'Error'},
			{message: 'Use schema-backed data.', object: 'Data', property: 'TaggedClass'},
			{message: 'Use Schema.TaggedError.', object: 'Data', property: 'TaggedError'}
		],
		'no-self-assign': 'error',
		'no-shadow': [
			'error',
			{allow: ['Array', 'Boolean', 'Console', 'Effect', 'HashMap', 'Number', 'Option', 'Schema', 'String']}
		],
		'no-sparse-arrays': 'error',
		'no-throw-literal': 'error',
		'no-unmodified-loop-condition': 'error',
		'no-unneeded-ternary': 'error',
		'no-unsafe-finally': 'error',
		'no-unused-expressions': 'error',
		'no-useless-assignment': 'error',
		'no-useless-backreference': 'error',
		'no-useless-call': 'error',
		'no-useless-catch': 'error',
		'no-useless-computed-key': 'error',
		'no-useless-concat': 'error',
		'no-useless-constructor': 'error',
		'no-useless-escape': 'error',
		'no-useless-rename': 'error',
		'no-useless-return': 'error',
		'no-void': 'error',
		'object-shorthand': 'error',

		// Oxc
		'oxc/branches-sharing-code': 'error',
		'oxc/no-accumulating-spread': 'error',
		'oxc/no-map-spread': 'error',
		'oxc/only-used-in-recursion': 'error',

		// JavaScript preferences
		'prefer-arrow-callback': 'error',
		'prefer-const': ['error', {destructuring: 'all'}],
		'prefer-template': 'error',
		'require-unicode-regexp': 'error',

		// React Doctor JSX and component contracts
		'react-doctor/no-call-component-as-function': 'error',
		'react-doctor/no-create-context-in-render': 'error',
		'react-doctor/no-default-props': 'error',
		'react-doctor/no-inline-exhaustive-style': 'error',
		'react-doctor/no-jsx-element-type': 'error',
		'react-doctor/no-many-boolean-props': 'error',
		'react-doctor/no-prop-types': 'error',
		'react-doctor/no-uncontrolled-input': 'error',

		// React Doctor effects and state
		'react-doctor/effect-listener-cleanup-mismatch': 'error',
		'react-doctor/no-async-effect-callback': 'error',
		'react-doctor/no-create-object-url-without-revoke': 'error',
		'react-doctor/no-derived-useState': 'error',
		'react-doctor/no-effect-event-in-deps': 'error',
		'react-doctor/no-effect-with-fresh-deps': 'error',
		'react-doctor/no-effect-wrapper-discards-callback-cleanup-return': 'error',
		'react-doctor/no-mutable-in-deps': 'error',
		'react-doctor/no-mutating-reducer-state': 'error',
		'react-doctor/no-self-updating-effect': 'error',
		'react-doctor/no-set-state-in-render': 'error',
		'react-doctor/no-stale-timer-ref': 'error',
		'react-doctor/prefer-use-effect-event': 'error',
		'react-doctor/rerender-functional-setstate': 'error',
		'react-doctor/rerender-lazy-ref-init': 'error',
		'react-doctor/rerender-lazy-state-init': 'error',

		// React Doctor browser and legacy APIs
		'react-doctor/no-event-handler': 'error',
		'react-doctor/no-flush-sync': 'error',

		// React Doctor rendering and compiler
		'react-doctor/no-render-in-render': 'error',
		'react-doctor/rendering-conditional-render': 'error',

		// React Doctor visual performance and accessibility
		'react-doctor/no-global-css-variable-animation': 'error',
		'react-doctor/no-gray-on-colored-background': 'error',
		'react-doctor/no-inline-bounce-easing': 'error',
		'react-doctor/no-large-animated-blur': 'error',
		'react-doctor/no-layout-property-animation': 'error',
		'react-doctor/no-layout-transition-inline': 'error',
		'react-doctor/no-long-transition-duration': 'error',
		'react-doctor/no-outline-none': 'error',
		'react-doctor/no-scale-from-zero': 'error',
		'react-doctor/no-transition-all': 'error',

		// React
		'react/button-has-type': 'error',
		'react/checked-requires-onchange-or-readonly': 'error',
		'react/exhaustive-deps': 'error',
		'react/iframe-missing-sandbox': 'error',
		'react/immutability': 'error',
		'react/incompatible-library': 'error',
		'react/jsx-boolean-value': ['error', 'never'],
		'react/jsx-curly-brace-presence': ['error', {children: 'never', propElementValues: 'always', props: 'never'}],
		'react/jsx-fragments': ['error', 'syntax'],
		'react/jsx-key': 'error',
		'react/jsx-no-script-url': 'error',
		'react/jsx-no-target-blank': 'error',
		'react/jsx-no-useless-fragment': 'error',
		'react/memo-dependencies': 'error',
		'react/no-array-index-key': 'error',
		'react/no-children-prop': 'error',
		'react/no-clone-element': 'error',
		'react/no-danger': 'error',
		'react/no-object-type-as-default-prop': 'error',
		'react/no-react-children': 'error',
		'react/no-unknown-property': 'error',
		'react/no-unstable-nested-components': ['error', {allowAsProps: true}],
		'react/preserve-manual-memoization': 'error',
		'react/purity': 'error',
		'react/refs': 'error',
		'react/rules-of-hooks': 'error',
		'react/self-closing-comp': 'error',
		'react/set-state-in-effect': 'error',
		'react/set-state-in-render': 'error',
		'react/static-components': 'error',
		'react/use-memo': 'error',
		'react/void-dom-elements-no-children': 'error',
		'react/void-use-memo': 'error',

		// JavaScript object order
		'sort-keys': ['error', 'asc', {allowLineSeparatedGroups: true, natural: true}],

		// TypeScript syntax
		'typescript/ban-ts-comment': ['error', {'ts-nocheck': true}],
		'typescript/no-restricted-types': [
			'error',
			{
				types: {
					AbortController: 'Use Effect interruption.',
					Date: 'Use DateTime.',
					Error: 'Use Schema.TaggedError.',
					Iterable: 'Use T[].',
					Map: 'Use HashMap.',
					Promise: 'Use Effect.',
					Readonly: 'Use a mutable type shape.',
					ReadonlyArray: 'Use T[].',
					ReadonlyMap: 'Use HashMap.',
					ReadonlySet: 'Use HashSet.',
					Set: 'Use HashSet.',
					undefined: 'Use an optional property, optional parameter, inference, or Option.'
				}
			}
		],
		'typescript/no-unnecessary-type-assertion': 'error',
		'typescript/no-useless-default-assignment': 'error',
		'typescript/switch-exhaustiveness-check': [
			'error',
			{considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false}
		],

		// Unicorn
		'unicorn/filename-case': 'error',
		'unicorn/no-immediate-mutation': 'error',
		'unicorn/no-lonely-if': 'error',
		'unicorn/no-null': 'error',
		'unicorn/no-object-as-default-parameter': 'error',
		'unicorn/no-process-exit': 'error',
		'unicorn/no-static-only-class': 'error',
		'unicorn/no-useless-fallback-in-spread': 'error',
		'unicorn/no-useless-length-check': 'error',
		'unicorn/no-useless-spread': 'error',
		'unicorn/no-useless-switch-case': 'error',
		'unicorn/prefer-logical-operator-over-ternary': 'error',
		'unicorn/prefer-optional-catch-binding': 'error',

		// JavaScript globals
		'use-isnan': 'error'
	},
	settings: {react: {version: '19.0'}}
})

export default definePlugin({
	meta: {name: '@deslop/workflow'},
	rules: {
		'no-array-wrap-ternary': noArrayWrapTernary,
		'no-constant-function': noConstantFunction,
		'no-deep-pipe': noDeepPipe,
		'no-error-message-assertion': noErrorMessageAssertion,
		'no-fake-ref-state': noFakeRefState,
		'no-native-method-call': noNativeMethodCall,
		'no-readonly-type-syntax': noReadonlyTypeSyntax,
		'no-redundant-use-ref-null-type': noRedundantUseRefNullType,
		'no-stored-schema-operation': noStoredSchemaOperation,
		'no-trivial-indirection': noTrivialIndirection,
		'no-typeof': noTypeof,
		'no-undestructured-use-state': noUndestructuredUseState,
		'no-unexplained-disable': noUnexplainedDisable,
		'no-unvalidated-json-decode': noUnvalidatedJsonDecode,
		'schema-type-pair': schemaTypePair
	}
})
