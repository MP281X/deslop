import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ExposeInput} from '#contracts'

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
