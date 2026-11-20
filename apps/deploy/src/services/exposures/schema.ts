import {Schema, Struct} from 'effect'

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
	// Who listened on the port when it was published; Deploy withdraws the site from a new owner of the port and publishes it again when this owner listens again.
	owner: Model.FieldOption(Schema.String),
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024})),
	// What should be true on the worker: `removing` is saved before any external change and never published again.
	state: Schema.Literals(['active', 'removing'])
}) {
	static readonly table = 'exposures'
}

// Public exposure needs explicit consent, which is checked and not kept.
export type ExposeInput = typeof ExposeInput.Type
export const ExposeInput = Schema.Struct({
	...Struct.pick(Exposure.fields, ['hostname', 'kind', 'name', 'port']),
	publicAccess: Schema.Boolean
})

export type ExposeRequest = typeof ExposeRequest.Type
export const ExposeRequest = Schema.Struct({...ExposeInput.fields, worker: WorkerId})

export type HideRequest = typeof HideRequest.Type
export const HideRequest = Schema.Struct({name: ExposureName, worker: WorkerId})
