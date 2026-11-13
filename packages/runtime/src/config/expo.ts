import {Boolean, Config, Effect, Option} from 'effect'

import type {ExpoConfig} from 'expo/config'

// EAS sets APP_VARIANT from the build profile; the simulator build gets its own bundle identifier and name.
export function makeExpoConfig(app: {projectId: string; slug: string}) {
	// oxlint-disable-next-line eslint/no-restricted-properties -- Expo loads the app config outside any Effect runtime.
	return Effect.runSync(
		Effect.gen(function* () {
			const release = yield* Config.withDefault(Config.Int('RELEASE_NUMBER'), 0)
			const team = yield* Config.option(Config.String('APPLE_TEAM_ID'))
			const production =
				(yield* Config.withDefault(Config.Literals(['development', 'production'], 'APP_VARIANT'), 'development')) ===
				'production'
			const variant = Boolean.match(production, {
				onFalse: () => ({
					bundleIdentifier: `xyz.mp281x.${app.slug}.dev`,
					name: `${app.slug} dev`,
					scheme: `${app.slug}-dev`
				}),
				onTrue: () => ({bundleIdentifier: `xyz.mp281x.${app.slug}`, name: app.slug, scheme: app.slug})
			})
			return {
				appGroup: `group.${variant.bundleIdentifier}`,
				config: {
					// The compiler memoizes components, as on the web, so a changed row re-renders without the rest of its list.
					experiments: {reactCompiler: true},
					extra: {eas: {projectId: app.projectId}, scheme: variant.scheme},
					ios: {
						...Option.match(team, {onNone: () => ({}), onSome: appleTeamId => ({appleTeamId})}),
						buildNumber: `${release}`,
						bundleIdentifier: variant.bundleIdentifier,
						config: {usesNonExemptEncryption: false},
						deploymentTarget: '26.0',
						// An Icon Composer package: the object over a light tile or the system's dark one, and iOS renders tinted and clear.
						icon: './src/routes/app.icon',
						supportsTablet: false
					},
					name: variant.name,
					orientation: 'portrait',
					owner: 'mp281x.xyz',
					platforms: ['ios'],
					plugins: ['expo-web-browser'],
					runtimeVersion: {policy: 'fingerprint'},
					scheme: variant.scheme,
					slug: app.slug,
					updates: {url: `https://u.expo.dev/${app.projectId}`},
					userInterfaceStyle: 'automatic',
					version: `0.1.${release}`
				} satisfies ExpoConfig
			}
		})
	)
}
