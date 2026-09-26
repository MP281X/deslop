import {NodeServices} from '@effect/platform-node'
import {expect, it} from '@effect/vitest'

import {Array, Effect, Layer, pipe} from 'effect'

import {createModels} from '@earendil-works/pi-ai'
import {fauxAssistantMessage, fauxProvider} from '@earendil-works/pi-ai/providers/faux'
import {Prompt} from 'effect/unstable/ai'

import {PiToolkit} from '#schema'
import {Ai} from '#service'

import {handlers} from './tools.ts'

it.layer(NodeServices.layer)('Pi', test => {
	test.effect(
		'answers through a scripted model offered the skill and subagent tools',
		Effect.fnUntraced(function* () {
			const faux = fauxProvider({models: [{id: 'gpt-5.6-luna'}], provider: 'openai-codex'})
			faux.setResponses([
				context =>
					fauxAssistantMessage(
						pipe(
							context.tools ?? [],
							Array.map(tool => tool.name),
							Array.join(',')
						)
					)
			])
			const models = createModels()
			models.setProvider(faux.provider)
			const handlersContext = yield* Layer.build(PiToolkit.toLayer(handlers('.')))
			const output = yield* pipe(
				Ai.generateText(
					{
						agents: [{description: 'explore', instructions: '', name: 'explore', skills: [], tools: []}],
						main: {
							description: 'main',
							instructions: '',
							name: 'main',
							skills: [{description: 'Review code', instructions: 'Review.', name: 'review'}],
							tools: []
						},
						model: {id: 'gpt-5.6-luna', provider: 'openai-codex', reasoning: 'low'},
						models,
						toolkit: PiToolkit
					},
					Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Reply with exactly OK.'})]})
				),
				Effect.provide(handlersContext)
			)

			expect(output).toBe('skill,subagent')
		})
	)
})
