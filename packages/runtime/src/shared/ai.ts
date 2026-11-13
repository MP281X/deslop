import {Schema, pipe} from 'effect'

export type AiModelId = typeof AiModelId.Type
export const AiModelId = pipe(Schema.String, Schema.brand('AiModelId'))
