import {createRequire} from 'node:module'

import {RegistryContext} from '@effect/atom-react'
import {assert, it} from '@effect/vitest'

import {Effect, Schema, pipe} from 'effect'

const registryModule = Schema.Struct({RegistryContext: Schema.Unknown})

it.effect(
	'shares the app registry with native components instead of falling back to an independent registry',
	Effect.fnUntraced(function* () {
		for (const app of ['stash', 'trips', 'opm']) {
			const require = createRequire(`${import.meta.dirname}/../../../apps/${app}/package.json`)
			const hooks = yield* pipe(
				Effect.promise(
					() =>
						import(
							/* @vite-ignore */
							require.resolve('@effect/atom-react')
						)
				),
				Effect.flatMap(Schema.decodeUnknownEffect(registryModule))
			)
			assert.isTrue(hooks.RegistryContext === RegistryContext, `${app}: shared controls must read the app's registry`)
		}
	})
)
