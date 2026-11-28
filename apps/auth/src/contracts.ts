import {IdentityRpcs} from '#identity/contract.ts'
import {PeopleRpcs} from '#people/contract.ts'
import {SessionsRpcs} from '#sessions/contract.ts'

// Whoever asks for their own account is not yet a person, so only the people's and the sessions' groups take the caller's authentication.
export const RpcContracts = PeopleRpcs.merge(SessionsRpcs, IdentityRpcs)
