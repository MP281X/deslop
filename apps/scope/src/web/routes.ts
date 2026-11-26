import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {TimeFrame} from '@deslop/runtime/shared/time'

import {AppName, Runtime, SpanId, TraceId} from '#contracts'

const search = {
	operation: Schema.OptionFromOptionalKey(Schema.String),
	pane: Schema.OptionFromOptionalKey(Schema.Literals(['Traces', 'Trace', 'Span'])),
	range: Schema.OptionFromOptionalKey(TimeFrame),
	side: Schema.OptionFromOptionalKey(Runtime),
	source: Schema.OptionFromOptionalKey(AppName),
	span: Schema.OptionFromOptionalKey(SpanId),
	trace: Schema.OptionFromOptionalKey(TraceId)
}

export const ScopeRoute = Route.union({Home: Route.make('/', {search}), Other: Route.make('/*', {search})})
