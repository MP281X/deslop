import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {
	appOrigin,
	authOrigin,
	bundle,
	keychainGroup,
	scheme,
	sessionKey,
	sessionService,
	tripsVariant
} from './src/iphone/origin.ts'

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: bundle,
		deploymentTarget: '26.0',
		entitlements: {
			'aps-environment': tripsVariant('production', 'development'),
			'keychain-access-groups': [keychainGroup]
		},
		icon: './src/iphone/app.icon',
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
	name: tripsVariant('trips', 'trips dev'),
	orientation: 'default',
	platforms: ['ios'],
	plugins: ['expo-secure-store', 'expo-notifications', '@bacons/apple-targets'],
	scheme,
	slug: 'trips',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
