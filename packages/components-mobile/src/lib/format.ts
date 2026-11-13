// fallow-ignore-file code-duplication -- components-web's react-dom peer keeps it off the iPhone, so these forms repeat its format.ts until the runtime's shared side holds both.
import {DateTime, Duration, Number} from 'effect'

const DATES = 'en-GB'

// A UTC instant reads in this device's zone; a zoned one in its own, such as a station's.
function inZone(at: DateTime.DateTime, options: Intl.DateTimeFormatOptions) {
	if (DateTime.isZoned(at)) return DateTime.format(at, {...options, locale: DATES})
	return DateTime.formatLocal(at, {...options, locale: DATES})
}

// How long ago, in its largest whole unit: "now" within the first minute, then "5m", "3h", "2d".
export function ageOf(since: DateTime.DateTime, now: DateTime.DateTime) {
	const minutes = Number.max(0, Math.floor(Duration.toMinutes(DateTime.distance(since, now))))
	if (minutes < 1) return 'now'
	if (minutes < 60) return `${minutes}m`
	if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
	return `${Math.floor(minutes / 1440)}d`
}

// A day: "21 Oct" this year, "21 Oct 2025" in another.
export function dayOf(at: DateTime.DateTime) {
	if (DateTime.getPart(at, 'year') === DateTime.getPart(DateTime.nowUnsafe(), 'year')) {
		return inZone(at, {day: 'numeric', month: 'short'})
	}
	return inZone(at, {day: 'numeric', month: 'short', year: 'numeric'})
}

// A day with its weekday, for plans: "Fri 21 Nov".
export function weekdayOf(at: DateTime.DateTime) {
	return inZone(at, {day: 'numeric', month: 'short', weekday: 'short'})
}
