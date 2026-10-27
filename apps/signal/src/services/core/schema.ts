import type {Option} from 'effect'
import {Schema} from 'effect'

import {Action} from '#services/game/schema.ts'

export type ModelId = typeof ModelId.Type
export const ModelId = Schema.Literals(['deepseek/deepseek-v4.1-flash-1017', 'typesafe/jev-router'])

export type Plan = typeof Plan.Type
// The answer comes first so it streams to the player while the orders are still being written; a bounded list keeps a looping model from spending its whole output budget on one repeated order.
export const Plan = Schema.Struct({answer: Schema.String, orders: Schema.Array(Action).check(Schema.isMaxLength(6))})

// The answer so far while the plan streams; the last draft carries the whole plan.
export type Draft = {answer: string; plan: Option.Option<Plan>}

export type RaidResponse = typeof RaidResponse.Type
export const RaidResponse = Schema.Literals(['escort', 'reroute', 'hold'])

export type EncounterResponse = typeof EncounterResponse.Type
export const EncounterResponse = Schema.Literals(['watch', 'avoid', 'ignore'])
