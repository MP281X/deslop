import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

const BUNDLE_IDENTIFIER = 'xyz.mp281x.stash'
const origins = iphoneOrigins('stash')
const group = `group.${BUNDLE_IDENTIFIER}`
const keychain = `$(AppIdentifierPrefix)${group}`

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: BUNDLE_IDENTIFIER,
		deploymentTarget: '26.0',
		entitlements: {
			'aps-environment': 'production',
			'com.apple.security.application-groups': [group],
			'keychain-access-groups': [keychain]
		},
		icon: './src/iphone/app.icon',
		infoPlist: {
			DeslopKeychainGroup: keychain,
			DeslopServer: origins.appOrigin,
			ITSAppUsesNonExemptEncryption: false,
			NSSupportsLiveActivities: true
		},
		supportsTablet: true
	},
	name: 'Stash',
	orientation: 'default',
	platforms: ['ios'],
	plugins: ['@bacons/apple-targets'],
	scheme: origins.scheme,
	slug: 'stash',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
