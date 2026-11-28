import {Array, Boolean, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {matches} from '#lib/ast.ts'

const ROOT_FILE = /^(?:app\.config\.ts|fingerprint\.config\.js|metro\.config\.ts|vite\.config\.ts)$/u
// Folders whose files are not source the layout governs.
const OUTSIDE_SRC = /^(?:\.expo|bin|dist|ios|modules|node_modules|public|targets)\//u
const APP_FILE = /^src\/(?:app|contracts|reads|server|view)(?:\.test)?\.ts$/u
const HOST_ENTRY = /^src\/(?:iphone|web)\/main\.ts$/u
const HOST_FOLDER = /^src\/(?:iphone|web)\//u
const SRC_FILE = /^src\/[^/]+$/u
const LAYER_FOLDER =
	/^src\/(?:client|common|components|helpers|hooks|lib|models|pages|routes|screens|server|services|shared|stores|types|utils)\//u
const FEATURE_FILE = /^src\/[^/]+\/[^/]+$/u
const GENERIC_FILE = /^src\/[^/]+\/(?:common|constants|helpers|index|lib|types|utils)(?:\.test|\.d)?\.[cm]?[jt]sx?$/u

// The app a file sits in, and its path below the app's root.
const APP = /^.*\/(?:apps\/([^/]+)|tools\/create-app\/template)\/(.*)$/u

function problemWith(relative: string) {
	if (matches(ROOT_FILE)(relative) || matches(OUTSIDE_SRC)(relative)) return undefined
	if (!String.includes('/')(relative)) return "Keep the app's root to its configuration; code lives in src."
	if (matches(APP_FILE)(relative) || matches(HOST_ENTRY)(relative)) return undefined
	if (matches(HOST_FOLDER)(relative)) {
		return 'Keep only main.ts in src/web and src/iphone: the runtime shell supplies sign-in, origin, session and router, and each screen draws once in its feature view.'
	}
	if (!matches(/^src\//u)(relative)) return 'Keep code in src.'
	if (matches(SRC_FILE)(relative)) {
		return 'Keep src to server.ts, app.ts, view.ts, reads.ts and contracts.ts, the host entries and feature folders.'
	}
	if (matches(LAYER_FOLDER)(relative)) {
		return 'Group by feature, not by layer: give each feature one folder directly under src.'
	}
	if (!matches(FEATURE_FILE)(relative)) {
		return 'Keep a feature folder flat: its files sit directly in it, with no folders of their own.'
	}
	if (matches(GENERIC_FILE)(relative)) {
		return 'Name this file for its topic; a feature holds contract, server, handlers, migrations, screen and view, and a few files named for what they do, each beside its test.'
	}
	return undefined
}

export const appLayout = defineRule({
	create: context => ({
		Program: node => {
			const unmigrated = Array.filter(context.options, Predicate.isString)
			const message = pipe(
				String.match(APP)(String.replaceAll('\\', '/')(context.filename)),
				Option.filter(found =>
					pipe(
						found,
						Array.get(1),
						Option.exists(name => Array.contains(unmigrated, name)),
						Boolean.not
					)
				),
				Option.flatMap(Array.get(2)),
				Option.flatMapNullishOr(problemWith),
				Option.getOrUndefined
			)
			if (message !== undefined) context.report({message, node})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [{'sample.ts': 'export function remaining(limit: number, used: number) { return limit - used }'}]
			}
		},
		// The apps not yet moved to the layout, by folder name; every other app and the template must follow it.
		schema: {items: {type: 'string'}, type: 'array', uniqueItems: true},
		type: 'problem'
	}
})
