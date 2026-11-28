import {Boolean, Function} from 'effect'

import type {ExpoConfig} from 'expo/config'

import {iphoneUpdates} from '@deslop/runtime/config/iphone'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

import {development, variant} from './src/push/shared.ts'

const origins = iphoneOrigins('opm')

export default {
	experiments: {inlineModules: {watchedDirectories: ['src/iphone/native']}},
	ios: {
		appleTeamId: '99K7MQUK7F',
		associatedDomains: [`webcredentials:${new URL(origins.authOrigin).hostname}`],
		bundleIdentifier: variant.bundle,
		deploymentTarget: '26.0',
		icon: './src/iphone/app.icon',
		infoPlist: {ITSAppUsesNonExemptEncryption: false, NSSupportsLiveActivities: true},
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
	scheme: variant.scheme,
	slug: 'opm',
	userInterfaceStyle: 'dark',
	...iphoneUpdates(origins.appOrigin)
} satisfies ExpoConfig
