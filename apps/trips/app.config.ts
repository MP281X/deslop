import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

import {bundle, keychainGroup, scheme, sessionKey, sessionService, tripsVariant} from './src/push/shared.ts'

const origins = iphoneOrigins('trips')

export default {
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: bundle,
		deploymentTarget: '26.0',
		entitlements: {
			'aps-environment': tripsVariant('production', 'development'),
			'keychain-access-groups': [keychainGroup]
		},
		icon: './src/iphone/app.icon',
		infoPlist: {
			DeslopKeychainGroup: keychainGroup,
			DeslopServer: origins.appOrigin,
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
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
