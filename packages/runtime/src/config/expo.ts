// This file's text is not part of the native fingerprint; plugins and mods live in their own module.
import {Boolean, Config, Effect, Option, Schema} from 'effect'

import type {ExpoConfig} from 'expo/config'

export const DEVELOPMENT_BUNDLE_SUFFIX = '.dev'

type ThemeColor = {dark: string; light: string}
type ShareColors = {
	background: ThemeColor
	destructive: ThemeColor
	foreground: ThemeColor
	mutedForeground: ThemeColor
}

// EAS sets APP_VARIANT from the build profile; the simulator build gets its own bundle identifier and name.
export function makeExpoConfig(app: {projectId: string; slug: string}) {
	// oxlint-disable-next-line eslint/no-restricted-properties -- Expo loads the app config outside any Effect runtime.
	return Effect.runSync(
		Effect.gen(function* () {
			// The one domain every app, Auth and Scope live under; builds and updates fail without it.
			const domain = yield* Config.schema(Schema.NonEmptyString, 'DESLOP_DOMAIN')
			const release = yield* Config.withDefault(Config.Int('RELEASE_NUMBER'), 0)
			const team = yield* Config.option(Config.String('APPLE_TEAM_ID'))
			const production =
				(yield* Config.withDefault(Config.Literals(['development', 'production'], 'APP_VARIANT'), 'development')) ===
				'production'
			const variant = Boolean.match(production, {
				onFalse: () => ({
					bundleIdentifier: `xyz.mp281x.${app.slug}${DEVELOPMENT_BUNDLE_SUFFIX}`,
					name: `${app.slug} dev`,
					scheme: `${app.slug}-dev`
				}),
				onTrue: () => ({bundleIdentifier: `xyz.mp281x.${app.slug}`, name: app.slug, scheme: app.slug})
			})
			const keychainGroup = `$(AppIdentifierPrefix)group.${variant.bundleIdentifier}`
			return {
				appGroup: `group.${variant.bundleIdentifier}`,
				config: {
					// The compiler memoizes components, as on the web, so a changed row re-renders without the rest of its list.
					experiments: {reactCompiler: true},
					extra: {domain, eas: {projectId: app.projectId}, scheme: variant.scheme},
					ios: {
						...Option.match(team, {onNone: () => ({}), onSome: appleTeamId => ({appleTeamId})}),
						associatedDomains: [`webcredentials:auth.${domain}`],
						buildNumber: `${release}`,
						bundleIdentifier: variant.bundleIdentifier,
						config: {usesNonExemptEncryption: false},
						deploymentTarget: '26.0',
						// An Icon Composer package: the object over a light tile or the system's dark one, and iOS renders tinted and clear.
						icon: './src/routes/app.icon',
						supportsTablet: false
					},
					name: variant.name,
					owner: 'mp281x.xyz',
					platforms: ['ios'],
					plugins: ['expo-web-browser'],
					runtimeVersion: {policy: 'fingerprint'},
					scheme: variant.scheme,
					slug: app.slug,
					updates: {url: `https://u.expo.dev/${app.projectId}`},
					userInterfaceStyle: 'automatic',
					version: `0.1.${release}`
				} satisfies ExpoConfig,
				// What a share extension reads from its app's Info.plist, as apple-targets sets no keys on the extension: the Keychain group both save to, the server and the app's colors to draw with.
				shareExtension: (colors: ShareColors, primary: ThemeColor) => ({
					// A Keychain item saved without a group lands in the app's first group, the one the share extension reads.
					entitlements: {'keychain-access-groups': [keychainGroup]},
					infoPlist: {
						DeslopKeychainGroup: keychainGroup,
						DeslopServer: `https://${app.slug}.${domain}`,
						DeslopTheme: {
							background: colors.background,
							destructive: colors.destructive,
							foreground: colors.foreground,
							muted: colors.mutedForeground,
							primary
						}
					}
				})
			}
		})
	)
}
