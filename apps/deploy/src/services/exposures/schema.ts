import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ExposureName, WorkerId} from '#services/inventory/schema.ts'

// An HTTPS mapping Deploy owns on this worker: a tailnet port, or a public hostname in front of a local port.
export class Exposure extends Model.Class<Exposure>('Exposure')({
	hostname: Schema.String.check(
		Schema.isMaxLength(253),
		Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
	),
	kind: Schema.Literals(['tailnet', 'public']),
	name: ExposureName.check(Schema.isNonEmpty(), Schema.isMaxLength(260)),
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024}))
}) {
	static readonly table = 'exposures'
}

// Public exposure needs explicit consent, which is checked and not kept.
export type ExposeInput = typeof ExposeInput.Type
export const ExposeInput = Schema.Struct({...Exposure.fields, publicAccess: Schema.Boolean})

export type ExposeRequest = typeof ExposeRequest.Type
export const ExposeRequest = Schema.Struct({...ExposeInput.fields, worker: WorkerId})

export type HideRequest = typeof HideRequest.Type
export const HideRequest = Schema.Struct({name: ExposureName, worker: WorkerId})
