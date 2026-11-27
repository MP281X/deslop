import {Effect} from 'effect'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

import {ExposuresRpcs} from '#contracts'

import {Machine} from '#server/machine/service.ts'

export const exposuresHandlers = ExposuresRpcs.toLayer(
	Effect.map(Machine, machine =>
		ExposuresRpcs.of({'exposures.expose': input => Effect.flatMap(CurrentAdmin, admin => machine.expose(input, admin))})
	)
)
