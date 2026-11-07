import {redact} from '@tanstack/redact/vite'

import * as ViteConfig from '@deslop/runtime/vite'

export default {...ViteConfig.config, plugins: [...ViteConfig.config.plugins, redact({environments: ['client']})]}
