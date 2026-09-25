// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import {NodeHttpServer} from '@effect/platform-node'

import {Config, Effect, Layer, pipe} from 'effect'

import {OTLPLogExporter} from '@opentelemetry/exporter-logs-otlp-http'
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http'
import {BatchLogRecordProcessor} from '@opentelemetry/sdk-logs'
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base'
import {HttpStaticServer} from 'effect/unstable/http'
import {RpcSerialization} from 'effect/unstable/rpc'

export function layer(applicationName: string) {
	return Layer.mergeAll(
		Layer.unwrap(
			Effect.map(pipe(Config.url('VITE_OTEL_URL'), Config.withDefault(new URL('http://localhost:4318'))), url =>
				NodeSdk.layer(() => ({
					logRecordProcessor: new BatchLogRecordProcessor({
						exporter: new OTLPLogExporter({url: new URL('/v1/logs', url).href})
					}),
					resource: {serviceName: `${applicationName}-server`},
					spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({url: new URL('/v1/traces', url).href}))
				}))
			)
		),
		RpcSerialization.layerMsgPack
	)
}

export const layerStaticFiles = HttpStaticServer.layer({
	index: 'index.html',
	root: fileURLToPath(new URL('./client', import.meta.url)),
	spa: true
})

export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: pipe(Config.string('HOST'), Config.withDefault('0.0.0.0')),
	port: pipe(Config.port('PORT'), Config.withDefault(5000))
})
