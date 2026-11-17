import {Schema} from 'effect'

export type Profile = typeof Profile.Type
const Profile = Schema.Struct({DisplayName: Schema.String, ID: Schema.Finite, LoginName: Schema.String})
const Node = Schema.Struct({Tags: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)))})
export const Whois = Schema.Struct({Node, UserProfile: Profile})
export const Status = Schema.Struct({
	Self: Schema.Struct({...Node.fields, UserID: Schema.Finite}),
	User: Schema.Record(Schema.String, Profile)
})
