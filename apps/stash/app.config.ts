import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, scheme} from './src/iphone/origin.ts'

const BUNDLE_IDENTIFIER = 'xyz.mp281x.stash'
const group = `group.${BUNDLE_IDENTIFIER}`
const keychain = `$(AppIdentifierPrefix)${group}`

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
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
			DeslopServer: appOrigin,
			ITSAppUsesNonExemptEncryption: false,
			NSSupportsLiveActivities: true
		},
		supportsTablet: true
	},
	name: 'Stash',
	orientation: 'default',
	platforms: ['ios'],
	plugins: ['@bacons/apple-targets'],
	scheme,
	slug: 'stash',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
