import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, scheme} from './src/iphone/origin.ts'

export default {
	icon: './src/iphone/app.icon',
	ios: {
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: 'xyz.mp281x.templateBundleSlug',
		supportsTablet: true
	},
	name: 'template-app',
	orientation: 'default',
	platforms: ['ios'],
	scheme,
	slug: 'template-app',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
