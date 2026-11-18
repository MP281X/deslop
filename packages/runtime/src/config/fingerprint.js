// oxlint-disable-next-line effecttsgo/node-builtin-import -- Expo loads the fingerprint config synchronously, which Effect's FileSystem cannot read in.
import {readFileSync} from 'node:fs'
// oxlint-disable-next-line effecttsgo/node-builtin-import -- The path joins the file read above.
import {join} from 'node:path'

import {Array, Config, Effect, Order, Predicate, Record, Schema, pipe} from 'effect'

// The package.json scripts run JavaScript tooling only, and the version and build number move with every release, so neither rebuilds the native app. eas.json counts only as the profile the build resolves, below.
export const sourceSkips = ['ExpoConfigVersions', 'PackageJsonScriptsAll', 'EasJson']

/** @param {unknown} parent @param {unknown} child @returns {unknown} */
function merged(parent, child) {
	if (!Predicate.isObject(parent) || !Predicate.isObject(child) || Array.isArray(parent) || Array.isArray(child)) {
		return child
	}
	return Record.union(parent, child, merged)
}

/** @param {unknown} value @returns {unknown} */
function sorted(value) {
	if (Array.isArray(value)) return Array.map(value, sorted)
	if (!Predicate.isObject(value)) return value
	return pipe(
		Record.toEntries(value),
		Array.sortWith(entry => entry[0], Order.String),
		Record.fromIterableWith(entry => [entry[0], sorted(entry[1])])
	)
}

// The build profile EAS uses for this variant, its `extends` chain merged as EAS merges it, in one canonical text: another profile or the file's formatting leaves the native fingerprint alone, while any setting of this profile still changes it. The simulator and production profiles each set APP_VARIANT, which picks one.
/** @param {string} directory */
export function easBuildProfile(directory) {
	// oxlint-disable-next-line eslint/no-restricted-properties -- Expo loads the fingerprint config outside any Effect runtime.
	return Effect.runSync(
		Effect.gen(function* () {
			const variant = yield* Config.withDefault(
				Config.Literals(['development', 'production'], 'APP_VARIANT'),
				'development'
			)
			const profiles = (yield* Schema.decodeEffect(
				Schema.fromJsonString(
					Schema.Struct({build: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))})
				)
			)(readFileSync(join(directory, 'eas.json'), 'utf8'))).build
			/** @param {string} name @returns {Record<string, unknown>} */
			function resolve(name) {
				const profile = profiles[name] ?? {}
				const parent = profile['extends']
				if (!Predicate.isString(parent)) return profile
				return pipe(resolve(parent), Record.union(profile, merged), Record.remove('extends'))
			}
			const chosen = pipe(
				Record.keys(profiles),
				Array.map(resolve),
				Array.filter(
					profile => Predicate.hasProperty(profile['env'], 'APP_VARIANT') && profile['env']['APP_VARIANT'] === variant
				)
			)
			if (chosen.length !== 1) {
				return yield* Effect.die(`eas.json needs exactly one build profile with APP_VARIANT ${variant}`)
			}
			return {
				contents: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(sorted(chosen[0])),
				id: 'easBuildProfile',
				reasons: ['easBuild'],
				type: 'contents'
			}
		})
	)
}
