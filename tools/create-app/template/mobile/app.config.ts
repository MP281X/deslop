import * as ExpoRuntime from '@deslop/runtime/mobile/expo'

export default ExpoRuntime.make({
	bundleIdentifier: 'xyz.mp281x.template-app',
	name: 'template-app',
	owner: 'mp281x.xyz',
	// `npx eas-cli init` prints the project id.
	projectId: '00000000-0000-0000-0000-000000000000',
	server: 'https://dev.tailnet-8c4c.ts.net:5000',
	slug: 'template-app'
}).config
