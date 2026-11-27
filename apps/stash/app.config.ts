import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, scheme} from './src/iphone/origin.ts'

const bundleIdentifier = 'xyz.mp281x.stash'
const group = `group.${bundleIdentifier}`
const keychain = `$(AppIdentifierPrefix)${group}`

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier,
		deploymentTarget: '26.0',
		entitlements: {
			'aps-environment': 'production',
			'com.apple.security.application-groups': [group],
			'keychain-access-groups': [keychain]
		},
		icon: './src/iphone/app.icon',
		infoPlist: {DeslopKeychainGroup: keychain, DeslopServer: appOrigin, NSSupportsLiveActivities: true},
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
