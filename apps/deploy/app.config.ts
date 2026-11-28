import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

const origins = iphoneOrigins('deploy')

export default {
	ios: {
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.deploy',
		icon: './src/iphone/app.icon',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'Deploy',
	orientation: 'default',
	platforms: ['ios'],
	scheme: origins.scheme,
	slug: 'deploy',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
