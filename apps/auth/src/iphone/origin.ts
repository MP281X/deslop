declare const process: {readonly env: {readonly EXPO_PUBLIC_APP_URL?: string}}

// Auth is its own issuer. The app and callback always use the same origin.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://auth.mp281x.xyz'
export const scheme = 'auth'
