import {createRequire} from 'node:module'

import {RegistryContext} from '@effect/atom-react'
import {assert, it} from '@effect/vitest'

import {Effect, Schema} from 'effect'

type RegistryModule = typeof RegistryModule.Type
const RegistryModule = Schema.Struct({RegistryContext: Schema.Unknown})

it.effect(
	'shares the app registry with native components instead of falling back to an independent registry',
	Effect.fnUntraced(function* () {
		for (const app of ['stash', 'trips', 'opm']) {
			const require = createRequire(`${import.meta.dirname}/../../../apps/${app}/package.json`)
			const hooks = yield* Effect.flatMap(
				Effect.promise(
					() =>
						import(
							/* @vite-ignore */
							require.resolve('@effect/atom-react')
						)
				),
				Schema.decodeUnknownEffect(RegistryModule)
			)
			assert.isTrue(hooks.RegistryContext === RegistryContext, `${app}: shared controls must read the app's registry`)
		}
	})
)
