import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, scheme} from './src/iphone/origin.ts'

export default {
	icon: './src/iphone/app.icon',
	ios: {
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.scope',
		supportsTablet: true
	},
	name: 'scope',
	orientation: 'default',
	platforms: ['ios'],
	scheme,
	slug: 'scope',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
