import {Predicate, Schema} from 'effect'

// Tailscale's user ids exceed JavaScript's safe integers, so every number in its answers is read as the decimal text it wrote.
function exactNumbers(_key: string, value: unknown, context?: {readonly source?: string}) {
	if (Predicate.isNumber(value)) return context?.source
	return value
}

export type TailnetUserId = typeof TailnetUserId.Type
export const TailnetUserId = Schema.String.check(Schema.isPattern(/^\d+$/u))
export type Profile = typeof Profile.Type
export const Profile = Schema.Struct({DisplayName: Schema.String, ID: TailnetUserId, LoginName: Schema.String})
export type Node = typeof Node.Type
export const Node = Schema.Struct({Tags: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)))})
export type Whois = typeof Whois.Type
export const Whois = Schema.Struct({Node, UserProfile: Profile})
export type WhoisJson = typeof WhoisJson.Type
export const WhoisJson = Schema.fromJsonString(Whois, {reviver: exactNumbers})
export type Status = typeof Status.Type
export const Status = Schema.Struct({
	Self: Schema.Struct({...Node.fields, UserID: TailnetUserId}),
	User: Schema.Record(TailnetUserId, Profile)
})
export type StatusJson = typeof StatusJson.Type
export const StatusJson = Schema.fromJsonString(Status, {reviver: exactNumbers})
