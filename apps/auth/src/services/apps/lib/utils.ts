import {Array, Order, String} from 'effect'

import type {App, Catalog} from '#services/apps/schema.ts'

export function registerApp(current: Catalog, app: App) {
	return Array.sort(
		[...Array.filter(current, known => known.origin !== app.origin), app],
		Order.mapInput(String.Order, (known: App) => known.name)
	)
}
