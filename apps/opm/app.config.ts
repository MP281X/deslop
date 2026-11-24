import {makeExpoConfig} from '@deslop/runtime/config/expo'

const app = makeExpoConfig({projectId: 'b8424bc0-2ea7-43bc-9096-7eed93e31f5b', slug: 'opm'})

// Probe: the production config alone declares an entitlement no App Store profile holds.
const ios =
	process.env['APP_VARIANT'] === 'production'
		? {...app.config.ios, entitlements: {'com.apple.developer.kernel.increased-memory-limit': true}}
		: app.config.ios

export default {...app.config, ios, plugins: [...app.config.plugins, 'expo-secure-store', 'expo-notifications']}
