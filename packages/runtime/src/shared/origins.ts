declare const process: {readonly env: {readonly EXPO_PUBLIC_APP_URL?: string; readonly EXPO_PUBLIC_AUTH_URL?: string}}

// The app's own origin, Auth's and the URL scheme, from the app's name. Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export function iphoneOrigins(name: string) {
	const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? `https://${name}.mp281x.xyz`
	// Auth is its own issuer, so its app and its callback always use the same origin.
	if (name === 'auth') return {appOrigin, authOrigin: appOrigin, scheme: name}
	return {appOrigin, authOrigin: process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.mp281x.xyz', scheme: name}
}
