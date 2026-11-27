import {Array, MutableRef, Option, Predicate} from 'effect'

import {ScopeRoute} from '#web/routes.ts'
import {levelOf, rangeOf, selectionFor} from '#web/telemetry/model.ts'
import type {Model} from '#web/telemetry/model.ts'
import type {Search} from '#web/telemetry/selection.ts'

const uaTransition = MutableRef.make('')

addEventListener(
	'popstate',
	event => {
		if (event.hasUAVisualTransition) MutableRef.set(uaTransition, location.href)
	},
	{capture: true}
)

export function usedHistoryMotion() {
	return MutableRef.getAndSet(uaTransition, '') === location.href
}

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
	const index = navigation.currentEntry?.index
	if (index === undefined || index < 1) return false
	// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Navigation's entries() reads this document's session history.
	const entry = Option.getOrUndefined(Array.get(navigation.entries(), index - 1))
	if (Predicate.isNullish(entry?.url)) return false
	const url = new URL(entry.url)
	if (url.origin !== location.origin || url.pathname !== location.pathname) return false
	return Option.exists(ScopeRoute.parse(url.pathname + url.search), route => {
		const search = route.search
		if (rangeOf(search) !== rangeOf(parent) || levelOf(search) !== levelOf(parent)) return false
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
}
