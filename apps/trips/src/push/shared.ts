declare const process: {readonly env: {readonly EXPO_PUBLIC_TRIPS_DEV?: string}}

// Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
const development = process.env.EXPO_PUBLIC_TRIPS_DEV === '1'

// The release app, or the Simulator build on Apple's sandbox.
export function tripsVariant<A>(release: A, sandbox: A) {
	if (development) return sandbox
	return release
}

export const scheme = tripsVariant('trips', 'trips-dev')
export const bundle = tripsVariant('xyz.mp281x.trips', 'xyz.mp281x.trips.dev')
export const sessionService = 'trips-auth'
export const sessionKey = 'auth.session'
export const keychainGroup = `99K7MQUK7F.group.${bundle}`
