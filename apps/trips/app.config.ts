import {palette} from '@deslop/components-mobile/palette'
import {makeExpoConfig} from '@deslop/runtime/config/expo'

const app = makeExpoConfig({projectId: '3778dc9f-a54b-454e-ae4e-4ef7f115e391', slug: 'trips'})
const share = app.shareExtension(palette.colors, palette.hues.orange)

export default {
	...app.config,
	ios: {
		...app.config.ios,
		entitlements: share.entitlements,
		infoPlist: share.infoPlist,
		// The server starts a Live Activity on a broadcast channel when the app is closed.
		usesBroadcastPushNotifications: true
	},
	plugins: [
		...app.config.plugins,
		'@bacons/apple-targets',
		'expo-secure-store',
		'expo-notifications',
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
