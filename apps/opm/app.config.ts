import {Boolean, Function} from 'effect'

import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'

import {appOrigin, authOrigin, bundle, development, scheme} from './src/iphone/origin.ts'

export default {
	experiments: {inlineModules: {watchedDirectories: ['src/iphone/native']}},
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(authOrigin).hostname}`],
		bundleIdentifier: bundle,
		deploymentTarget: '26.0',
		icon: './src/iphone/app.icon',
		infoPlist: {NSSupportsLiveActivities: true},
		supportsTablet: false
	},
	name: 'OPM',
	orientation: 'default',
	platforms: ['ios'],
	plugins: [
		[
			'expo-notifications',
			{
				mode: Boolean.match(development, {
					onFalse: Function.constant('production'),
					onTrue: Function.constant('development')
				})
			}
		],
		'@bacons/apple-targets'
	],
	scheme,
	slug: 'opm',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(appOrigin)
} satisfies ExpoConfig
