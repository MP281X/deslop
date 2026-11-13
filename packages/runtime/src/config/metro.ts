import {getDefaultConfig} from 'expo/metro-config'

export function makeMetroConfig(directory: string) {
	// oxlint-disable-next-line effecttsgo/process-env -- Expo loads this configuration without an Effect runtime.
	process.env['EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH'] = '1'
	// oxlint-disable-next-line effecttsgo/process-env -- Expo reads this flag while building its Metro configuration.
	process.env['EXPO_UNSTABLE_TREE_SHAKING'] = '1'
	return getDefaultConfig(directory)
}
