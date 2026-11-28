import {Effect, Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, CurrentAdmin, CurrentUser} from '@deslop/runtime/shared/auth'

import {ExposeInput, ExposuresRpcs} from './contract.ts'

import {ExposureName} from '#inventory/contract.ts'
import {DeployError} from '#machine/contract.ts'
import {Machine} from '#machine/server.ts'

export const exposuresTools = Toolkit.make(
	Tool.make('create_exposure', {
		dependencies: [CurrentUser],
		description:
			'Give a listening local port the requested HTTPS hostname and ownership name; public exposure requires explicit publicAccess=true consent. Caddy’s admin port is refused, and a Deslop app’s port is published only under the app’s own name and only when it runs with a domain. Returns the URL, adds no authentication and starts no application; list_apps shows owned exposures.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: ExposeInput,
		success: Schema.Struct({url: Schema.String})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_exposure', {
		dependencies: [CurrentUser],
		description:
			'Remove an HTTPS exposure Deploy owns by name from list_apps, not its backend. Externally changed Tailscale mappings are refused; an accepted removal is saved first, finishes on its own when this call fails and is never undone.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: Schema.Struct({name: ExposureName.check(Schema.isNonEmpty())}),
		success: Schema.Struct({name: ExposureName})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)

export const exposuresToolHandlers = exposuresTools.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		return exposuresTools.of({
			create_exposure: Effect.fnUntraced(function* (input) {
				return {
					url: yield* machine.expose(
						input,
						yield* requireAdmin(yield* CurrentUser, 'Only an admin can create exposures')
					)
				}
			}),
			remove_exposure: Effect.fnUntraced(function* (input) {
				yield* machine.hide(input.name, yield* requireAdmin(yield* CurrentUser, 'Only an admin can remove exposures'))
				return input
			})
		})
	})
)

export const exposuresHandlers = ExposuresRpcs.toLayer(
	Effect.map(Machine, machine =>
		ExposuresRpcs.of({'exposures.expose': input => Effect.flatMap(CurrentAdmin, admin => machine.expose(input, admin))})
	)
)
