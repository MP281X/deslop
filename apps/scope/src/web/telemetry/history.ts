import {Option} from 'effect'

import {hasHistoryBehind} from '@deslop/ui/viewport'

import {ScopeRoute} from '#web/routes.ts'
import {levelOf, rangeOf, selectionFor} from '#web/telemetry/model.ts'
import type {Model} from '#web/telemetry/model.ts'
import type {Search} from '#web/telemetry/selection.ts'

export function parentSearch(search: Search): Search {
	if (levelOf(search) === 2) return {...search, pane: Option.some('Trace'), span: Option.none()}
	return {
		...search,
		operation: Option.none(),
		pane: Option.none(),
		side: Option.none(),
		span: Option.none(),
		trace: Option.none()
	}
}

export function hasParentBehind(model: Model, parent: Search) {
	return hasHistoryBehind(
		url =>
			url.pathname === location.pathname &&
			Option.exists(ScopeRoute.parse(url.pathname + url.search), route => {
				if (rangeOf(route.search) !== rangeOf(parent) || levelOf(route.search) !== levelOf(parent)) return false
				const previous = selectionFor({...model, route})
				if (!Option.contains(parent.source, Option.getOrUndefined(previous.source))) return false
				if (levelOf(parent) === 0) return true
				return (
					Option.exists(
						previous.activeKey,
						key => Option.contains(parent.operation, key.name) && Option.contains(parent.side, key.runtime)
					) && Option.exists(previous.activeTrace, trace => Option.contains(parent.trace, trace.id))
				)
			})
	)
}
