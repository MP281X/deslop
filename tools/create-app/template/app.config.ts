import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, scheme} from './src/iphone/origin.ts'

export default {
	name: 'template-app',
	slug: 'template-app',
	scheme,
	platforms: ['ios'],
	orientation: 'default',
	userInterfaceStyle: 'dark',
	ios: {bundleIdentifier: 'xyz.mp281x.templateBundleSlug', supportsTablet: true},
		icon: './src/iphone/app.icon',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
