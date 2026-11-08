import {Schema} from 'effect'

export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['anthropic', 'openrouter', 'opencode-zen', 'opencode-go'])

// Set on Gateway's own refusal of an app's grant, which a provider's 401 for a wrong key never carries.
export const GRANT_REFUSED = 'x-gateway-grant-refused'
