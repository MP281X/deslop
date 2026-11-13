import {Schema} from 'effect'

import Constants from 'expo-constants'

// The app's Expo config, which every build carries: the URL scheme it opens on, its slug and its release.
export const appConfig = Schema.decodeUnknownSync(
	Schema.Struct({extra: Schema.Struct({scheme: Schema.String}), slug: Schema.String, version: Schema.String})
)(Constants.expoConfig)
