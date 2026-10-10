import {Config, Effect, Option, pipe} from 'effect'

import type {ConfigContext, ExpoConfig} from 'expo/config'

// Each EAS profile builds its own app, so the development, preview and TestFlight builds sit side by side on the iPhone.
const variants = {
	development: {name: 'stash dev', scheme: 'stash-dev', suffix: '.dev'},
	preview: {name: 'stash preview', scheme: 'stash-preview', suffix: '.preview'},
	production: {name: 'stash', scheme: 'stash', suffix: ''}
}

// EAS reads APP_VARIANT from eas.json and APPLE_TEAM_ID from the project's EAS environment variables.
// RELEASE_NUMBER is the GitHub Actions run number, the same one that versions the published packages.
// oxlint-disable-next-line eslint/no-restricted-properties -- Expo loads this file synchronously, outside any Effect runtime.
const settings = Effect.runSync(
	Effect.gen(function* () {
		return {
			release: yield* pipe(Config.Int('RELEASE_NUMBER'), Config.withDefault(0)),
			server: yield* pipe(Config.String('STASH_SERVER'), Config.withDefault('https://dev.tailnet-8c4c.ts.net:8443')),
			team: yield* Config.option(Config.String('APPLE_TEAM_ID')),
			variant: yield* pipe(
				Config.Literals(['development', 'preview', 'production'], 'APP_VARIANT'),
				Config.withDefault('development')
			)
		}
	})
)

const variant = variants[settings.variant]
const bundleIdentifier = `xyz.mp281x.stash${variant.suffix}`
const appGroup = `group.${bundleIdentifier}`
const projectId = 'c9620553-0dc5-4e08-b691-a47fa3cab00e'

// app.json keeps only the Expo owner; the EAS project ID also names the update server, so it lives here.
export default (context: ConfigContext): ExpoConfig => ({
	...context.config,
	extra: {...context.config.extra, appGroup, eas: {projectId}, server: settings.server},
	icon: './src/routes/icon.png',
	ios: {
		appleTeamId: Option.getOrUndefined(settings.team),
		buildNumber: `${settings.release}`,
		bundleIdentifier,
		config: {usesNonExemptEncryption: false},
		deploymentTarget: '18.0',
		entitlements: {'com.apple.security.application-groups': [appGroup]},
		// The share extension reads the server from the app's Info.plist.
		infoPlist: {StashServer: settings.server},
		supportsTablet: false
	},
	name: variant.name,
	orientation: 'portrait',
	platforms: ['ios'],
	plugins: [
		'@bacons/apple-targets',
		['expo-font', {fonts: ['./targets/share/JetBrainsMono-Regular.ttf', './targets/share/JetBrainsMono-SemiBold.ttf']}]
	],
	// JavaScript changes reach the installed build through EAS Update; the fingerprint changes with any native change,
	// so an update never reaches a build whose native code differs.
	runtimeVersion: {policy: 'fingerprint'},
	scheme: variant.scheme,
	slug: 'stash',
	updates: {url: `https://u.expo.dev/${projectId}`},
	userInterfaceStyle: 'automatic',
	version: `0.1.${settings.release}`
})
