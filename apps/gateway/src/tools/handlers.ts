import {Array, Effect, Function, Layer, Option, Struct, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerMcp} from '@deslop/runtime/server/http'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai-proxy/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway, GatewayDiscovery} from '#services/gateway/service.ts'
import {QUESTION_CARD_URI, ToolContracts} from '#tools/contracts.ts'

// An MCP App: the host sends ask_question's arguments, and a tapped answer goes back as the user's message.
const QUESTION_CARD = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width">
<style>
body { margin: 0; font: 14px/1.4 var(--font-sans, system-ui); color: var(--color-text-primary); }
main { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--color-border-primary); border-radius: var(--border-radius-md, 8px); background: var(--color-background-secondary); }
p { margin: 0 0 4px; font-weight: 600; }
button { font: inherit; text-align: left; padding: 10px 12px; border: 1px solid var(--color-border-secondary); border-radius: var(--border-radius-md, 8px); background: var(--color-background-primary); color: inherit; cursor: pointer; }
button:disabled { cursor: default; color: var(--color-text-secondary); }
button[aria-pressed='true'] { color: var(--color-text-primary); border-color: var(--color-ring-primary); }
</style>
</head>
<body>
<main hidden><p></p></main>
<script>
const main = document.querySelector('main')
const pending = new Map()
let next = 0
const post = message => window.parent.postMessage({jsonrpc: '2.0', ...message}, '*')
const request = (method, params) =>
	new Promise((resolve, reject) => {
		next += 1
		pending.set(next, {reject, resolve})
		post({id: next, method, params})
	})
const style = context => {
	for (const [name, value] of Object.entries(context?.styles?.variables ?? {})) document.documentElement.style.setProperty(name, value)
}
const render = ({answers, question}) => {
	main.querySelector('p').textContent = question
	for (const answer of answers) {
		const button = document.createElement('button')
		button.textContent = answer
		button.onclick = () => {
			const buttons = main.querySelectorAll('button')
			for (const other of buttons) other.disabled = true
			button.setAttribute('aria-pressed', 'true')
			request('ui/message', {content: [{text: answer, type: 'text'}], role: 'user'}).catch(() => {
				for (const other of buttons) other.disabled = false
				button.removeAttribute('aria-pressed')
			})
		}
		main.append(button)
	}
	main.hidden = false
}
window.addEventListener('message', ({data, source}) => {
	if (source !== window.parent || data?.jsonrpc !== '2.0') return
	if (data.method === undefined) {
		const entry = pending.get(data.id)
		pending.delete(data.id)
		if (data.error === undefined) entry?.resolve(data.result)
		else entry?.reject(data.error)
	} else if (data.method === 'ui/notifications/tool-input' && main.hidden) render(data.params.arguments)
	else if (data.method === 'ui/notifications/host-context-changed') style(data.params)
})
new ResizeObserver(() =>
	post({method: 'ui/notifications/size-changed', params: {height: Math.ceil(document.body.getBoundingClientRect().height)}})
).observe(document.body)
request('ui/initialize', {appCapabilities: {}, appInfo: {name: 'Question', version: '1'}, protocolVersion: '2026-01-26'}).then(result => {
	style(result.hostContext)
	post({method: 'ui/notifications/initialized', params: {}})
})
</script>
</body>
</html>
`

const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const ai = yield* AiProxy
		const connections = yield* Connections
		const gateway = yield* Gateway
		return ToolContracts.of({
			ask_question: input => Effect.succeed({question: input.question}),
			list_mcp_connections: Effect.fnUntraced(function* (input) {
				const all = yield* connections.definitions
				yield* pipe(
					input.server,
					Option.filter(id => !Array.some(all, server => server.id === id)),
					Option.match({
						onNone: () => Effect.void,
						onSome: id =>
							AuthError.make({
								message: `Unknown server ${id}; valid servers: ${pipe(
									all,
									Array.map(server => server.id),
									Array.join(', ')
								)}. Nothing changed.`
							})
					})
				)
				return {
					servers: pipe(
						all,
						Array.filter(server =>
							Option.match(input.server, {onNone: Function.constTrue, onSome: id => server.id === id})
						),
						Array.map(server => ({
							error: server.error,
							instructions: Option.filter(server.instructions, () => Option.contains(input.server, server.id)),
							...Struct.pick(server, ['id', 'status', 'tools'])
						}))
					)
				}
			}),
			remove_ai_key: Effect.fnUntraced(function* (input) {
				yield* ai.removeKey((yield* CurrentUser).id, input.provider)
				return {provider: input.provider}
			}),
			remove_mcp_server: Effect.fnUntraced(function* (input) {
				yield* connections.remove(
					input.server,
					yield* requireAdmin(yield* CurrentUser, 'Only an admin can manage MCP servers')
				)
				yield* gateway.removed
				return {server: input.server}
			})
		})
	})
)

export const GatewayMcp = pipe(
	layerMcp({
		contracts: ToolContracts,
		instructions:
			'Tools use <server>__<tool>. Use list_mcp_connections for missing or failing tools; name a server to read its full instructions.',
		registrations: pipe(
			McpServer.toolkit(ToolContracts),
			Layer.provide(ToolHandlers),
			Layer.merge(
				McpServer.resource({
					content: Effect.succeed(QUESTION_CARD),
					mimeType: 'text/html;profile=mcp-app',
					name: 'Question card',
					uri: QUESTION_CARD_URI
				})
			)
		)
	}),
	Layer.provide(GatewayDiscovery.layer),
	Layer.provide(McpServer.McpServer.layer)
)
