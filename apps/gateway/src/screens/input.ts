import {Predicate} from 'effect'

export const ADD_LABEL = 'MCP server URL or provider key'
export const ADD_PLACEHOLDER = 'Paste a key or a server URL'
export const KEY_LABEL = 'OpenCode, Anthropic or OpenAI key'

export function inputValue(payload: unknown) {
	if (Predicate.hasProperty(payload, 'value') && Predicate.isString(payload.value)) return payload.value
	return undefined
}
