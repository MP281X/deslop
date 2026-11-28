import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

const origins = iphoneOrigins('auth')

export default {
	ios: {
		associatedDomains: [`webcredentials:${new URL(origins.appOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.auth',
		icon: './src/iphone/app.icon',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'Auth',
	orientation: 'default',
	platforms: ['ios'],
	scheme: origins.scheme,
	slug: 'auth',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
