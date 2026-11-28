import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAdmin} from '@deslop/runtime/shared/auth'

import {ExposureName} from '#inventory/contract.ts'
import {DeployError} from '#machine/contract.ts'

// Public exposure needs explicit consent, which is checked and not kept.
export type ExposeInput = typeof ExposeInput.Type
export const ExposeInput = Schema.Struct({
	hostname: Schema.String.check(
		Schema.isMaxLength(253),
		Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
	),
	kind: Schema.Literals(['tailnet', 'public']),
	name: ExposureName.check(Schema.isNonEmpty(), Schema.isMaxLength(260)),
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024})),
	publicAccess: Schema.Boolean
})

export const ExposuresRpcs = RpcGroup.make(
	Rpc.make('exposures.expose', {
		error: Schema.Union([AuthError, DeployError]),
		payload: ExposeInput,
		success: Schema.String
	}).middleware(RpcAdmin)
)

// An HTTPS mapping Deploy owns on this machine: a tailnet port, or a public hostname in front of a local port.
export class Exposure extends Model.Class<Exposure>('Exposure')({
	hostname: ExposeInput.fields.hostname,
	kind: ExposeInput.fields.kind,
	name: ExposeInput.fields.name,
	// Who listened on the port when it was published; Deploy withdraws the site from a new owner of the port and publishes it again when this owner listens again.
	owner: Model.FieldOption(Schema.String),
	port: ExposeInput.fields.port,
	// What should be true on the machine: `removing` is saved before any external change and never published again.
	state: Schema.Literals(['active', 'removing'])
}) {
	static readonly table = 'exposures'
}
