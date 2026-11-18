import {palette} from '@deslop/components-mobile/palette'
import {makeExpoConfig} from '@deslop/runtime/config/expo'

const app = makeExpoConfig({projectId: '3778dc9f-a54b-454e-ae4e-4ef7f115e391', slug: 'trips'})

export default {
	...app.config,
	ios: {
		...app.config.ios,
		entitlements: {
			// A Keychain item saved without a group lands in the app's first group, the one the share extension reads.
			'keychain-access-groups': [`$(AppIdentifierPrefix)${app.appGroup}`]
		},
		infoPlist: {
			DeslopKeychainGroup: `$(AppIdentifierPrefix)${app.appGroup}`,
			DeslopServer: `https://trips.${app.domain}`,
			DeslopTheme: {
				background: palette.colors.background,
				destructive: palette.colors.destructive,
				foreground: palette.colors.foreground,
				muted: palette.colors.mutedForeground,
				primary: palette.hues.orange
			}
		},
		// The server starts a Live Activity on a broadcast channel when the app is closed.
		usesBroadcastPushNotifications: true
	},
	plugins: [
		...app.config.plugins,
		'@bacons/apple-targets',
		'expo-secure-store',
		'expo-notifications',
		['expo-calendar', {calendarPermission: 'Trips keeps your flights, trains and stays in a Trips calendar.'}],
		// Only Apple's geocoder, for the coordinates of a stay's address; the app never asks where you are.
		['expo-location', {locationWhenInUsePermission: false}],
		[
			'expo-widgets',
			{
				bundleIdentifier: `${app.config.ios.bundleIdentifier}.activities`,
				enablePushNotifications: true,
				frequentUpdates: true,
				groupIdentifier: app.appGroup,
				widgets: []
			}
		]
	]
}
