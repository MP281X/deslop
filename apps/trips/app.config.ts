import * as ExpoRuntime from '@deslop/runtime/mobile/expo'

const app = ExpoRuntime.make({
	bundleIdentifier: 'xyz.mp281x.trips',
	name: 'trips',
	owner: 'mp281x.xyz',
	projectId: '3778dc9f-a54b-454e-ae4e-4ef7f115e391',
	slug: 'trips'
})

export default {
	...app.config,
	ios: {
		...app.config.ios,
		// The server starts a Live Activity on a broadcast channel when the app is closed.
		usesBroadcastPushNotifications: true
	},
	plugins: [
		...app.config.plugins,
		'expo-web-browser',
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
