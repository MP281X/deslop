import {Schema} from 'effect'

type Peer = typeof Peer.Type
const Peer = Schema.Struct({
	DNSName: Schema.String,
	HostName: Schema.String,
	OS: Schema.String,
	Online: Schema.Boolean,
	TailscaleIPs: Schema.Array(Schema.String)
})

export type TailnetStatus = typeof TailnetStatus.Type
export const TailnetStatus = Schema.Struct({Self: Schema.OptionFromOptionalKey(Peer)})

export type Serve = typeof Serve.Type
export const Serve = Schema.Struct({
	AllowFunnel: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, Schema.Boolean)),
	TCP: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, Schema.Json)),
	Web: Schema.OptionFromOptionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				Handlers: Schema.Record(Schema.String, Schema.Struct({Proxy: Schema.OptionFromOptionalKey(Schema.String)}))
			})
		)
	)
})
