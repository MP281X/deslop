import {Schema} from 'effect'

export class DeployError extends Schema.TaggedError<DeployError>()('DeployError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Item = typeof Item.Type
export const Item = Schema.Struct({
	detail: Schema.String,
	id: Schema.String,
	kind: Schema.Literals(['service', 'container', 'port', 'exposure', 'peer']),
	name: Schema.String,
	state: Schema.String,
	url: Schema.String,
	worker: Schema.String
})

export type Snapshot = typeof Snapshot.Type
export const Snapshot = Schema.Struct({
	items: Schema.Array(Item),
	sources: Schema.Array(Schema.Struct({error: Schema.String, name: Schema.String})),
	time: Schema.Finite
})

export type Worker = typeof Worker.Type
export const Worker = Schema.Struct({auth: Schema.String, name: Schema.NonEmptyString, url: Schema.String})

export type Peer = typeof Peer.Type
export const Peer = Schema.Struct({
	DNSName: Schema.String,
	HostName: Schema.String,
	OS: Schema.String,
	Online: Schema.Boolean,
	TailscaleIPs: Schema.Array(Schema.String)
})

export type Tailnet = typeof Tailnet.Type
export const Tailnet = Schema.Struct({
	Peer: Schema.optionalKey(Schema.Record(Schema.String, Peer)),
	Self: Schema.optionalKey(Peer)
})

export type Serve = typeof Serve.Type
export const Serve = Schema.Struct({
	AllowFunnel: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
	TCP: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
	Web: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({Handlers: Schema.Record(Schema.String, Schema.Struct({Proxy: Schema.optionalKey(Schema.String)}))})
		)
	)
})

export type Exposure = typeof Exposure.Type
export const Exposure = Schema.Struct({
	hostname: Schema.String.check(
		Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
	),
	kind: Schema.Literals(['tailnet', 'public']),
	name: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1024})),
	publicAccess: Schema.Boolean
})

export type ExposeRequest = typeof ExposeRequest.Type
export const ExposeRequest = Schema.Struct({...Exposure.fields, target: Schema.optionalKey(Schema.String)})

export type HideRequest = typeof HideRequest.Type
export const HideRequest = Schema.Struct({name: Schema.String, target: Schema.optionalKey(Schema.String)})

export type Unit = typeof Unit.Type
export const Unit = Schema.Struct({
	active: Schema.String,
	description: Schema.String,
	sub: Schema.String,
	unit: Schema.String
})

export type Container = typeof Container.Type
export const Container = Schema.Struct({
	ID: Schema.String,
	Image: Schema.String,
	Names: Schema.String,
	Ports: Schema.String,
	State: Schema.String,
	Status: Schema.String
})
