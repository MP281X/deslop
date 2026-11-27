import {Number} from 'effect'

// The trips offered for the way to an airport, in minutes.
export const TRAVEL_CHOICES = [30, 35, 45, 60, 90, 120, 150, 180]

export function travelLabel(minutes: number) {
	const hours = Math.floor(minutes / 60)
	const rest = Number.remainder(minutes, 60)
	if (hours === 0) return `${rest} min`
	if (rest === 0) return `${hours} h`
	return `${hours} h ${rest} min`
}
