import {Layer} from 'effect'

import {runApp} from '@deslop/runtime/server/cli'

import {GitHubHttp} from '#server/github-actions/http.ts'
import {TelemetryHttp} from '#server/telemetry/http.ts'
import {TelemetryRpcs} from '#server/telemetry/rpcs.ts'
import {Telemetry} from '#server/telemetry/service.ts'
import {TelemetryMcp} from '#server/telemetry/tools.ts'
import icon from '#web/icon.svg'

// The receiver never exports its own spans or query traffic back into itself.
runApp({
	icon,
	routes: Layer.provide(Layer.mergeAll(TelemetryHttp, GitHubHttp, TelemetryRpcs, TelemetryMcp), Telemetry.layer),
	telemetry: false
})
