import * as ExpoRuntime from '@deslop/runtime/mobile/expo'

const app = ExpoRuntime.make({
	bundleIdentifier: 'xyz.mp281x.opm',
	name: 'opm',
	owner: 'mp281x.xyz',
	projectId: 'b8424bc0-2ea7-43bc-9096-7eed93e31f5b',
	slug: 'opm'
})

export default {
	...app.config,
	plugins: [...app.config.plugins, 'expo-web-browser', 'expo-secure-store', 'expo-notifications']
}
