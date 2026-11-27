import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, scheme} from './src/iphone/origin.ts'

export default {
	ios: {
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.deploy',
		icon: './src/iphone/app.icon',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'Deploy',
	orientation: 'default',
	platforms: ['ios'],
	scheme,
	slug: 'deploy',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
