import {palette} from '@deslop/components-mobile/palette'
import {makeExpoConfig} from '@deslop/runtime/config/expo'

const app = makeExpoConfig({projectId: 'c9620553-0dc5-4e08-b691-a47fa3cab00e', slug: 'stash'})
const share = app.shareExtension(palette.colors, palette.hues.amber)

export default {
	...app.config,
	ios: {
		...app.config.ios,
		entitlements: {...share.entitlements, 'com.apple.security.application-groups': [app.appGroup]},
		infoPlist: share.infoPlist
	},
	plugins: [...app.config.plugins, '@bacons/apple-targets']
}
