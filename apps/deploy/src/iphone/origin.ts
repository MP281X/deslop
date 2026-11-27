declare const process: {readonly env: {readonly EXPO_PUBLIC_APP_URL?: string; readonly EXPO_PUBLIC_AUTH_URL?: string}}

// Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://deploy.mp281x.xyz'
export const authOrigin = process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.mp281x.xyz'
export const scheme = 'deploy'
