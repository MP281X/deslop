import {Boolean, Predicate, Schema} from 'effect'

import {SdkHttpError, UnauthorizedError} from '@modelcontextprotocol/client'
import {McpClientError} from 'effect/ai'
import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/shared/auth'

import {FailureReason, UpstreamExchangeError, failureMessage} from './contract.ts'

export function describe(cause: unknown, depth = 0): FailureReason {
	if (depth >= 8) return FailureReason.cases.Unknown.make({})
	if (Schema.is(UpstreamExchangeError)(cause)) return cause.reason
	if (Predicate.isTagged(cause, 'TimeoutError')) return FailureReason.cases.Timeout.make({})
	if (cause instanceof SdkHttpError) return FailureReason.cases.HttpStatus.make({code: cause.status})
	if (cause instanceof UnauthorizedError) return FailureReason.cases.Unauthorized.make({})
	if (HttpClientError.isHttpClientError(cause) && cause.reason instanceof HttpClientError.StatusCodeError) {
		return FailureReason.cases.HttpStatus.make({code: cause.reason.response.status})
	}
	if (McpClientError.isMcpClientError(cause) && Schema.is(McpClientError.HttpError)(cause.reason)) {
		return FailureReason.cases.HttpStatus.make({code: cause.reason.status})
	}
	if (Predicate.isError(cause) && cause.cause !== undefined) return describe(cause.cause, depth + 1)
	if (Schema.is(AuthError)(cause)) {
		return Boolean.match(cause.error === 'temporarily_unavailable', {
			onFalse: () => FailureReason.cases.Unauthorized.make({}),
			onTrue: () => FailureReason.cases.Unavailable.make({})
		})
	}
	if (Predicate.hasProperty(cause, 'code') && cause.code === 'ECONNREFUSED') return FailureReason.cases.Refused.make({})
	return FailureReason.cases.Unknown.make({})
}

// Only fixed failure labels cross the boundary, including the serialized error's optional cause.
export function connectionFailure(prefix: string) {
	return (cause: unknown) => {
		const message = `${prefix}: ${failureMessage(describe(cause))}`
		if (Schema.is(AuthError)(cause)) {
			if (cause.error === undefined) return AuthError.make({message})
			return AuthError.make({error: cause.error, message})
		}
		return AuthError.make({error: 'temporarily_unavailable', message})
	}
}
