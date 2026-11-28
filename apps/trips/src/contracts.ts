import {FlightsRpcs} from '#flights/contract.ts'
import {PushRpcs} from '#push/contract.ts'
import {TrackingRpcs} from '#tracking/contract.ts'

export const RpcContracts = FlightsRpcs.merge(TrackingRpcs, PushRpcs)
