import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

const origins = iphoneOrigins('scope')

export default {
	icon: './src/iphone/app.icon',
	ios: {
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.scope',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'scope',
	orientation: 'default',
	platforms: ['ios'],
	scheme: origins.scheme,
	slug: 'scope',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
