import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {
	appOrigin,
	authOrigin,
	bundle,
	development,
	keychainGroup,
	scheme,
	sessionKey,
	sessionService
} from './src/iphone/origin.ts'

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: bundle,
		deploymentTarget: '26.0',
		icon: './src/iphone/app.icon',
		entitlements: {
			'aps-environment': development ? 'development' : 'production',
			'keychain-access-groups': [keychainGroup]
		},
		infoPlist: {
			DeslopKeychainGroup: keychainGroup,
			DeslopServer: appOrigin,
			DeslopSessionAccount: sessionKey,
			DeslopSessionService: `${sessionService}:no-auth`,
			ITSAppUsesNonExemptEncryption: false,
			NSSupportsLiveActivities: true,
			NSSupportsLiveActivitiesFrequentUpdates: true
		},
		supportsTablet: false,
		usesBroadcastPushNotifications: true
	},
	name: development ? 'trips dev' : 'trips',
	orientation: 'default',
	platforms: ['ios'],
	plugins: ['expo-secure-store', 'expo-notifications', '@bacons/apple-targets'],
	scheme,
	slug: 'trips',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
