// The package.json scripts run JavaScript tooling only, and the version and build number move with every release, so neither rebuilds the native app.
export const sourceSkips = ['ExpoConfigVersions', 'PackageJsonScriptsAll']
