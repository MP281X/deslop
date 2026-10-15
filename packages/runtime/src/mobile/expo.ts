import {Boolean, Config, Effect, Option, pipe} from 'effect'

import type {ExpoConfig} from 'expo/config'

// EAS sets APP_VARIANT from the build profile; the simulator build gets its own bundle identifier and name.
export function make(app: {
	bundleIdentifier: string
	name: string
	owner: string
	projectId: string
	server: string
	slug: string
}) {
	// oxlint-disable-next-line eslint/no-restricted-properties -- Expo loads the app config outside any Effect runtime.
	return Effect.runSync(
		Effect.gen(function* () {
			const release = yield* pipe(Config.Int('RELEASE_NUMBER'), Config.withDefault(0))
			const team = yield* Config.option(Config.String('APPLE_TEAM_ID'))
			const otel = yield* pipe(Config.String('OTEL_URL'), Config.withDefault('https://otel.mp281x.xyz'))
			const production =
				(yield* pipe(
					Config.Literals(['development', 'production'], 'APP_VARIANT'),
					Config.withDefault('development')
				)) === 'production'
			const variant = Boolean.match(production, {
				onFalse: () => ({
					bundleIdentifier: `${app.bundleIdentifier}.dev`,
					name: `${app.name} dev`,
					scheme: `${app.slug}-dev`
				}),
				onTrue: () => ({bundleIdentifier: app.bundleIdentifier, name: app.name, scheme: app.slug})
			})
			return {
				appGroup: `group.${variant.bundleIdentifier}`,
				config: {
					extra: {eas: {projectId: app.projectId}, otel, server: app.server},
					icon: './src/routes/icon.png',
					ios: {
						appleTeamId: Option.getOrUndefined(team),
						buildNumber: `${release}`,
						bundleIdentifier: variant.bundleIdentifier,
						config: {usesNonExemptEncryption: false},
						deploymentTarget: '18.0',
						supportsTablet: false
					},
					name: variant.name,
					orientation: 'portrait',
					owner: app.owner,
					platforms: ['ios'],
					plugins: ['@deslop/components-mobile'],
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
