import {Schema, pipe} from 'effect'

export type ApnsToken = typeof ApnsToken.Type
export const ApnsToken = pipe(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32,512}$/iu)), Schema.brand('ApnsToken'))
