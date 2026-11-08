import {Schema} from 'effect'

export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['anthropic', 'openrouter', 'opencode-zen', 'opencode-go'])
