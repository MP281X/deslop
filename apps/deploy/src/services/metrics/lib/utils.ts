import {Array, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import type {Counters, MachineHistory, Sample} from '#services/metrics/schema.ts'

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
		cores: pipe(
			stat,
			String.split('\n'),
			Array.filter(line => Option.isSome(String.match(/^cpu[0-9]+\s/u)(line))),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				const counts = Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
					Array.take(Array.drop(fields, 1), 8)
				)
				return {
					id: fields[0] ?? '',
					idle: (counts[3] ?? 0) + (counts[4] ?? 0),
					total: Array.reduce(counts, 0, (sum, value) => sum + value)
				}
			})
		),
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

function cpuUsage(current: {idle: number; total: number}, seconds: number, previous?: {idle: number; total: number}) {
	if (
		previous === undefined ||
		current.total <= previous.total ||
		current.idle < previous.idle ||
		seconds <= 0 ||
		seconds > 90
	) {
		return
	}
	return Number.clamp((1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100, {
		maximum: 100,
		minimum: 0
	})
}

export function sample(current: Counters, memory: string, disk: string, previous?: Counters, load?: string) {
	const values = Record.fromEntries(
		Array.map(String.split(String.trim(memory), '\n'), line => {
			const fields = String.split(line, /\s+/u)
			return [fields[0] ?? '', Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
		})
	)
	const seconds = (current.time - (previous?.time ?? current.time)) / 1000
	const baseline = Option.filter(Option.fromUndefinedOr(previous), old => old.uptime < current.uptime)
	const old = Option.getOrUndefined(baseline)
	return {
		cores: Array.map(current.cores ?? [], core => ({
			id: core.id,
			usage: cpuUsage(
				core,
				seconds,
				Option.getOrUndefined(Array.findFirst(old?.cores ?? [], candidate => candidate.id === core.id))
			)
		})),
		cpu: cpuUsage(
			{idle: current.cpuIdle, total: current.cpuTotal},
			seconds,
			Option.getOrUndefined(Option.map(baseline, value => ({idle: value.cpuIdle, total: value.cpuTotal})))
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
		load: Schema.decodeSync(Schema.Array(Schema.FiniteFromString))(
			Array.take(Array.filter(String.split(String.trim(load ?? ''), /\s+/u), String.isNonEmpty), 3)
		),
		memoryAvailable: values['MemAvailable:'] ?? 0,
		memoryBuffers: values['Buffers:'] ?? 0,
		memoryCached: (values['Cached:'] ?? 0) + (values['SReclaimable:'] ?? 0),
		memoryTotal: values['MemTotal:'] ?? 0,
		memoryUsed: (values['MemTotal:'] ?? 0) - (values['MemAvailable:'] ?? 0),
		networkReceive: rate(current.networkReceive, seconds, old?.networkReceive),
		networkSend: rate(current.networkSend, seconds, old?.networkSend),
		swapTotal: values['SwapTotal:'] ?? 0,
		swapUsed: (values['SwapTotal:'] ?? 0) - (values['SwapFree:'] ?? 0),
		time: current.time,
		uptime: current.uptime
	} satisfies Sample
}

export function resolution(hours: number) {
	return hours * 60_000
}

export function chartWindow(hours: number, now: number) {
	const end = Math.ceil(now / resolution(hours)) * resolution(hours)
	return {end, start: end - hours * 3_600_000}
}

function lastInBucket(bucket: readonly Sample[]) {
	return {...Option.getOrThrow(Array.last(bucket)), since: bucket[0]?.since ?? bucket[0]?.time}
}

export function compact(samples: readonly Sample[], now: number) {
	return pipe(
		samples,
		Array.filter(value => value.time >= now - 168 * 3_600_000),
		Array.groupBy(value => {
			const age = (now - value.time) / 3_600_000
			if (age <= 1) return `minute:${Math.floor(value.time / resolution(1))}`
			if (age <= 24) return `quarter:${Math.floor(value.time / 900_000)}`
			return `hour:${Math.floor(value.time / 3_600_000)}`
		}),
		Record.values,
		Array.map(lastInBucket),
		Array.sort(Order.mapInput(Order.Number, (value: Sample) => value.time))
	)
}

export function history(samples: readonly Sample[], hours: number, now: number) {
	const selected = pipe(
		Array.filter(samples, value => value.time > chartWindow(hours, now).start && value.time <= now),
		Array.groupBy(
			value =>
				`${Number.clamp(Math.ceil((value.time - chartWindow(hours, now).start) / resolution(hours)) - 1, {maximum: 59, minimum: 0})}`
		),
		Record.values,
		Array.map(lastInBucket)
	)
	// Every point keeps its cores and apps, which the charts split by; mounts and load stay on the latest only.
	return Array.map(selected, (value, index) => {
		if (index === selected.length - 1) return value
		return {
			...value,
			disks: [],
			load: undefined,
			storageUsed: value.storageUsed ?? Array.reduce(value.disks, 0, (sum, disk) => sum + disk.used),
			uptime: undefined
		}
	})
}

export function compactHistory(machine: MachineHistory, hours: number) {
	return {
		cpuModel: machine.cpuModel,
		current: Option.getOrUndefined(Array.last(machine.samples)),
		error: machine.error,
		intervalSeconds: resolution(hours) / 1000,
		recordedSince: machine.samples[0]?.since ?? machine.samples[0]?.time,
		series: {
			cpu: Array.map(machine.samples, value => Option.map(Option.fromUndefinedOr(value.cpu), Number.round(1))),
			diskRead: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.diskRead), Number.round(0))
			),
			diskWrite: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.diskWrite), Number.round(0))
			),
			memoryUsed: Array.map(machine.samples, value => value.memoryUsed),
			networkReceive: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.networkReceive), Number.round(0))
			),
			networkSend: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.networkSend), Number.round(0))
			),
			storageUsed: Array.map(
				machine.samples,
				value => value.storageUsed ?? Array.reduce(value.disks, 0, (sum, disk) => sum + disk.used)
			),
			swapUsed: Array.map(machine.samples, value => value.swapUsed),
			time: Array.map(machine.samples, value => value.time)
		},
		stale: machine.stale,
		time: machine.time,
		worker: machine.worker
	}
}
