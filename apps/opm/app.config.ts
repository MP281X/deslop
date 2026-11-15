import {makeExpoConfig} from '@deslop/runtime/config/expo'

const app = makeExpoConfig({projectId: 'b8424bc0-2ea7-43bc-9096-7eed93e31f5b', slug: 'opm'})

export default {...app.config, plugins: [...app.config.plugins, 'expo-secure-store', 'expo-notifications']}
