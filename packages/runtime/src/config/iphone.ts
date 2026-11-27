// The native downloader runs at launch without waiting or reloading the app.
export const IPHONE_UPDATE_PATH = '/api/iphone-update'

export function iphoneUpdates(origin: string) {
	return {
		runtimeVersion: {policy: 'fingerprint'},
		updates: {checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0, url: new URL(IPHONE_UPDATE_PATH, origin).href}
	} as const
}
