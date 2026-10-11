import {Config, Effect, Option, pipe} from 'effect'

import type {ExpoConfig} from 'expo/config'

// EAS sets APP_VARIANT from the build profile; the development build installs beside the TestFlight one.
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
			const bundleIdentifier = production ? app.bundleIdentifier : `${app.bundleIdentifier}.dev`
			return {
				appGroup: `group.${bundleIdentifier}`,
				config: {
					extra: {eas: {projectId: app.projectId}, otel, server: app.server},
					icon: './src/routes/icon.png',
					ios: {
						appleTeamId: Option.getOrUndefined(team),
						buildNumber: `${release}`,
						bundleIdentifier,
						config: {usesNonExemptEncryption: false},
						deploymentTarget: '18.0',
						supportsTablet: false
					},
					name: production ? app.name : `${app.name} dev`,
					orientation: 'portrait',
					owner: app.owner,
					platforms: ['ios'],
					plugins: ['@deslop/components-mobile'],
					runtimeVersion: {policy: 'fingerprint'},
					scheme: production ? app.slug : `${app.slug}-dev`,
					slug: app.slug,
					updates: {url: `https://u.expo.dev/${app.projectId}`},
					userInterfaceStyle: 'automatic',
					version: `0.1.${release}`
				} satisfies ExpoConfig
			}
		})
	)
}
