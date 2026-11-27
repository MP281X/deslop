import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, scheme} from './src/iphone/origin.ts'

export default {
	ios: {
		associatedDomains: [`webcredentials:${new URL(appOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.auth',
		icon: './src/iphone/app.icon',
		supportsTablet: true
	},
	name: 'Auth',
	orientation: 'default',
	platforms: ['ios'],
	scheme,
	slug: 'auth',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
