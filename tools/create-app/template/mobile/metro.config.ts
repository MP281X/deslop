// @effect-diagnostics processEnv:off -- Expo's Metro serializer reads its tree-shaking flags only from process.env.
import {getDefaultConfig} from 'expo/metro-config'

// Tree shaking drops the Effect modules the app never reaches, about a fifth of its release JavaScript.
process.env['EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH'] = '1'
process.env['EXPO_UNSTABLE_TREE_SHAKING'] = '1'

export default getDefaultConfig(import.meta.dirname)
