import * as WebSdk from '@effect/opentelemetry/WebSdk'

import {OTLPLogExporter} from '@opentelemetry/exporter-logs-otlp-http'
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http'
import {BatchLogRecordProcessor} from '@opentelemetry/sdk-logs'
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base'

export function layerWebSdk(serviceName: string, url: URL | string) {
	return WebSdk.layer(() => ({
		logRecordProcessor: new BatchLogRecordProcessor({
			exporter: new OTLPLogExporter({url: new URL('/v1/logs', url).href})
		}),
		resource: {serviceName},
		spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({url: new URL('/v1/traces', url).href}))
	}))
}
