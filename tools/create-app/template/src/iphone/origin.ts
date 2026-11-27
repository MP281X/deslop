declare const process: {readonly env: {readonly EXPO_PUBLIC_APP_URL?: string; readonly EXPO_PUBLIC_AUTH_URL?: string}}

// oxlint-disable-next-line effecttsgo/process-env -- Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const appOrigin = process.env.EXPO_PUBLIC_APP_URL ?? 'https://template-app.mp281x.xyz'
// oxlint-disable-next-line effecttsgo/process-env -- Expo inlines a direct EXPO_PUBLIC_* reference at bundle time.
export const authOrigin = process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.mp281x.xyz'
export const scheme = 'template-app'
