import {Schema, pipe} from 'effect'

export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['opencode-zen', 'opencode-go'])

export type AiModelId = typeof AiModelId.Type
export const AiModelId = pipe(Schema.String, Schema.brand('AiModelId'))
