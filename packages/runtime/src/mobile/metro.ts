/* oxlint-disable effecttsgo/process-env -- Expo reads its release optimization flags from process.env. */
import {getDefaultConfig} from 'expo/metro-config'

process.env['EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH'] = '1'
process.env['EXPO_UNSTABLE_TREE_SHAKING'] = '1'

export function metro(directory: string) {
	return getDefaultConfig(directory)
}
