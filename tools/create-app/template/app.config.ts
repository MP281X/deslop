import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

const origins = iphoneOrigins('template-app')

export default {
	ios: {
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.templateBundleSlug',
		icon: './src/iphone/app.icon',
		infoPlist: {ITSAppUsesNonExemptEncryption: false},
		supportsTablet: true
	},
	name: 'template-app',
	orientation: 'default',
	platforms: ['ios'],
	scheme: origins.scheme,
	slug: 'template-app',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
