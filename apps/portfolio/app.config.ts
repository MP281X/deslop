import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, scheme} from './src/iphone/origin.ts'

export default {
	ios: {
		bundleIdentifier: 'xyz.mp281x.portfolio',
		icon: './public/apple-touch-icon.png',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'Portfolio',
	orientation: 'default',
	platforms: ['ios'],
	scheme,
	slug: 'portfolio',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
