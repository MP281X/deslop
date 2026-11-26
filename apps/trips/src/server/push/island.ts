import {Boolean, Option} from 'effect'

import type {ActivityProps, Flight, TravelTime} from '#contracts'
import {boardsAt, clockAt, labelled, line, spanLabel, titleOf, travelTo, travellersLine} from '#journey'

export function islandOf(flight: Flight, props: ActivityProps, travel: readonly TravelTime[], stale: boolean) {
	const boards = clockAt(boardsAt(flight), flight.from.timeZone)
	if (props.phase === 'leave' || props.phase === 'airport') {
		const airport = Option.getOrElse(flight.from.code, () => flight.from.name)
		const heading = Boolean.match(props.phase === 'leave', {
			onFalse: () => `${airport} by`,
			onTrue: () => `Leave for ${airport} by`
		})
		return {
			...Option.match(travelTo(flight, travel), {
				onNone: () => ({}),
				onSome: time => ({detail: `${spanLabel(time)} by car`})
			}),
			footer: `${titleOf(flight)} · boards ${boards}`,
			title: `${heading} ${props.value}`,
			value: props.value,
			warning: false
		}
	}
	if (props.phase !== 'gate' && props.phase !== 'boarding') return undefined

	const gate = Option.filter(props.gate, () => !stale)
	const changed = Option.filter(gate, () => Option.isSome(props.was))
	const route = Option.all({from: flight.from.code, to: flight.to.code})
	const seats = labelled(
		'seat',
		travellersLine(flight, traveller => traveller.seat)
	)
	return {
		detail: `Boards ${boards}`,
		footer: line([Option.filter(labelled('Gate', gate), () => Option.isNone(changed)), seats]),
		title: Option.match(changed, {
			onNone: () => line([Option.some(titleOf(flight)), Option.map(route, place => `${place.from} → ${place.to}`)]),
			onSome: moved => `Gate changed to ${moved}`
		}),
		value: Option.getOrElse(gate, () => boards),
		warning: Option.isSome(changed)
	}
}
