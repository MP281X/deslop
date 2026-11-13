import {getDefaultConfig} from 'expo/metro-config'

process.env['EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH'] = '1'
process.env['EXPO_UNSTABLE_TREE_SHAKING'] = '1'

// oxlint-disable-next-line @deslop/coding-standards/no-trivial-indirection -- The runtime owns Expo's Metro flags, and each app supplies its own directory.
export function metro(directory: string) {
	return getDefaultConfig(directory)
}
