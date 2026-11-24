import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProvider} from '#services/ai-proxy/schema.ts'
import {ConnectionStatus, FailureReason, ServerId} from '#services/connections/schema.ts'

export const QUESTION_CARD_URI = 'ui://gateway/question'

export const ToolContracts = Toolkit.make(
	Tool.make('list_mcp_connections', {
		description:
			"Use when an MCP tool is missing or failing, or to see each server's state; returns each server's id, status, tool count and error, and one server's own instructions when named.",
		failure: AuthError,
		parameters: Schema.Struct({
			server: Schema.OptionFromOptionalKey(
				ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
			)
		}),
		success: Schema.Struct({
			servers: Schema.Array(
				Schema.Struct({
					error: Schema.OptionFromOptionalKey(FailureReason),
					id: ServerId,
					instructions: Schema.OptionFromOptionalKey(Schema.String),
					status: ConnectionStatus,
					tools: Schema.Int
				})
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_mcp_server', {
		dependencies: [CurrentUser],
		description:
			'Use when the user asks to remove a shared MCP server; removes it by the id list_mcp_connections returns.',
		failure: AuthError,
		parameters: Schema.Struct({
			server: ServerId.annotate({description: 'A server id, the prefix before __ in its tool names.'})
		}),
		success: Schema.Struct({server: ServerId})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_ai_key', {
		dependencies: [CurrentUser],
		description:
			'Use when the user asks to remove their OpenCode, Anthropic or OpenAI credential; stops their calls using that key.',
		failure: AuthError,
		parameters: Schema.Struct({provider: AiProvider}),
		success: Schema.Struct({provider: AiProvider})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('ask_question', {
		description:
			'Use to ask the user one question with a few short answers; shows a card in the thread, and the answer they tap arrives as their next message, so end your turn after calling it.',
		parameters: Schema.Struct({
			answers: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
			question: Schema.NonEmptyString
		}),
		success: Schema.Struct({question: Schema.String})
	})
		.annotate(Tool.Meta, {ui: {resourceUri: QUESTION_CARD_URI}})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true)
)
