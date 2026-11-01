import {Array, Number, Option, Record, Schema, String, pipe} from 'effect'

import type {Counters, Sample} from '#services/metrics/schema.ts'

export function counters(stat: string, network: string, disk: string, uptime: string, time: number) {
	const cpu = pipe(
		stat,
		String.split('\n'),
		Array.head,
		Option.getOrElse(() => ''),
		String.trim,
		String.split(/\s+/u)
	)
	const values = Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
		Array.take(Array.drop(cpu, 1), 8)
	)
	const interfaces = pipe(
		network,
		String.split('\n'),
		Array.filter(line => Option.isSome(String.match(/^\s*(?:eth|en|wl)[^:]*:/u)(line))),
		Array.map(line => String.split(String.trim(line), /\s+/u))
	)
	const devices = pipe(
		disk,
		String.split('\n'),
		Array.map(line => String.split(String.trim(line), /\s+/u)),
		Array.filter(fields => Option.isSome(String.match(/^(?:[svh]d[a-z]+|nvme[0-9]+n[0-9]+)$/u)(fields[2] ?? '')))
	)
	return {
		cpuIdle: (values[3] ?? 0) + (values[4] ?? 0),
		cpuTotal: Array.reduce(values, 0, (total, value) => total + value),
		diskRead: Array.reduce(
			devices,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[5] ?? '') * 512
		),
		diskWrite: Array.reduce(
			devices,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[9] ?? '') * 512
		),
		networkReceive: Array.reduce(
			interfaces,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '')
		),
		networkSend: Array.reduce(
			interfaces,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[9] ?? '')
		),
		time,
		uptime: Schema.decodeSync(Schema.FiniteFromString)(String.split(uptime, ' ')[0] ?? '')
	}
}

function rate(current: number, seconds: number, previous?: number) {
	if (previous === undefined || current < previous || seconds <= 0 || seconds > 90) return
	return (current - previous) / seconds
}

export function sample(current: Counters, memory: string, disk: string, previous?: Counters) {
	const values = Record.fromEntries(
		Array.map(String.split(String.trim(memory), '\n'), line => {
			const fields = String.split(line, /\s+/u)
			return [fields[0] ?? '', Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
		})
	)
	const seconds = (current.time - (previous?.time ?? current.time)) / 1000
	const baseline = Option.filter(Option.fromUndefinedOr(previous), old => old.uptime < current.uptime)
	const old = Option.getOrUndefined(baseline)
	const total = current.cpuTotal - (old?.cpuTotal ?? current.cpuTotal)
	return {
		cpu: Option.getOrUndefined(
			pipe(
				baseline,
				Option.filter(() => total > 0 && seconds > 0 && seconds <= 90),
				Option.map(value =>
					Number.clamp((1 - (current.cpuIdle - value.cpuIdle) / total) * 100, {maximum: 100, minimum: 0})
				)
			)
		),
		diskRead: rate(current.diskRead, seconds, old?.diskRead),
		diskWrite: rate(current.diskWrite, seconds, old?.diskWrite),
		disks: pipe(
			disk,
			String.trim,
			String.split('\n'),
			Array.drop(1),
			Array.filter(String.isNonEmpty),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				return {
					mount: fields[0] ?? '/',
					total: Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? ''),
					used: Schema.decodeSync(Schema.FiniteFromString)(fields[2] ?? '')
				}
			})
		),
		memoryTotal: values['MemTotal:'] ?? 0,
		memoryUsed: (values['MemTotal:'] ?? 0) - (values['MemAvailable:'] ?? 0),
		networkReceive: rate(current.networkReceive, seconds, old?.networkReceive),
		networkSend: rate(current.networkSend, seconds, old?.networkSend),
		swapTotal: values['SwapTotal:'] ?? 0,
		swapUsed: (values['SwapTotal:'] ?? 0) - (values['SwapFree:'] ?? 0),
		time: current.time
	} satisfies Sample
}

export function history(samples: readonly Sample[], hours: number, now: number) {
	return pipe(
		samples,
		Array.filter(value => value.time >= now - hours * 3_600_000 && value.time <= now),
		Array.groupBy(value => `${Math.floor(value.time / ((hours * 3_600_000) / 480))}`),
		Record.values,
		Array.map(bucket => Option.getOrThrow(Array.last(bucket)))
	)
}
