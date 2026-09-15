import {Context, Layer} from 'effect'
import type {Effect, Stream, SubscriptionRef} from 'effect'

import type {AgentOptions} from '@earendil-works/pi-agent-core'
import type {Models} from '@earendil-works/pi-ai'
import type {Prompt, Response, Toolkit} from 'effect/unstable/ai'

import {generateTextPi, makePi} from './internal/pi.ts'
import type {PiToolkit, AiAgentDefinition, AiError, AiModel, AiStatus} from './schema.ts'

export declare namespace Ai {
	export type Tools = Toolkit.Tools<typeof PiToolkit>
	export type Event = Prompt.UserMessage | Response.StreamPart<Tools>

	export type Agent = {
		events: Stream.Stream<Event>
		prompt: (message: Prompt.UserMessage) => Effect.Effect<void, AiError>
		status: SubscriptionRef.SubscriptionRef<AiStatus>
		stop: Effect.Effect<void>
	}
}

export declare namespace Pi {
	export type Config = {
		agents?: AiAgentDefinition[]
		history?: Prompt.Prompt
		main: AiAgentDefinition
		model: AiModel
		models: Models
		options?: Omit<AgentOptions, 'initialState' | 'sessionId' | 'streamFn'>
		toolkit: Toolkit.Toolkit<Ai.Tools>
	}
}

export class Ai extends Context.Service<Ai, Ai.Agent>()('@deslop/ai/service/Ai') {
	static generateText = generateTextPi

	static layerPi(config: Pi.Config) {
		return Layer.effect(this, makePi(config))
	}
}
