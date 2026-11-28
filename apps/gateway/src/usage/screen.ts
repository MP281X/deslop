import {Array, Boolean, Function, Number, Option} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'

export const TRACE_WIDTH = 50
export const TRACE_HEIGHT = 16

export function tracePoints(values: readonly number[]) {
	const peak = Array.reduce(values, 0, Number.max)
	const width = Number.max(1, values.length - 1)
	return Array.map(values, (value, index) => ({
		x: 1 + (index * (TRACE_WIDTH - 2)) / width,
		y: Boolean.match(peak === 0, {
			onFalse: () => TRACE_HEIGHT - 1 - (TRACE_HEIGHT - 2) * (value / peak),
			onTrue: Function.constant(TRACE_HEIGHT - 1)
		})
	}))
}

function readNotice(problem: string, retry: boolean) {
	return {loading: undefined, problem, retry, rows: undefined}
}

// A list and the usage drawn beside it: the rows once both have arrived, else what stands in their place.
export function readGroup<A, B, Row>(
	source: AsyncResult.AsyncResult<readonly A[], unknown>,
	usage: AsyncResult.AsyncResult<B, unknown>,
	label: string,
	placeholderCount: number,
	rows: (items: readonly A[], usage: B) => readonly Row[]
) {
	const items = Option.getOrUndefined(AsyncResult.value(source))
	const report = Option.getOrUndefined(AsyncResult.value(usage))
	function failed(cause: Cause.Cause<unknown>) {
		if (needsSignInCause(cause)) return readNotice('Signing in…', false)
		if (isDeniedCause(cause)) return readNotice('Access denied', false)
		return readNotice(`Couldn’t load ${label}`, true)
	}
	const failure = Option.getOrUndefined(blockingFailure(source))
	if (failure !== undefined) return failed(failure)
	if (items !== undefined && Array.isReadonlyArrayEmpty(items)) {
		return {loading: undefined, problem: undefined, retry: false, rows: Array.empty<Row>()}
	}
	const usageFailure = Option.getOrUndefined(blockingFailure(usage))
	if (usageFailure !== undefined) return failed(usageFailure)
	if (items === undefined || report === undefined) {
		return {loading: items?.length ?? placeholderCount, problem: undefined, retry: false, rows: undefined}
	}
	return {loading: undefined, problem: undefined, retry: false, rows: rows(items, report)}
}
