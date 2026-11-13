import {DateTime, Duration, Number, String} from 'effect'

// One English form for what a person reads on the web and the iPhone: dates day first on a 24-hour clock ("21 Oct", "15:28"), numbers grouped ("1,234", "$1.23").
const DATES = 'en-GB'
const NUMBERS = 'en'
const CLOCKS = {
	millisecond: {fractionalSecondDigits: 3, hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit'},
	minute: {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'},
	second: {hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit'}
} satisfies Record<'millisecond' | 'minute' | 'second', Intl.DateTimeFormatOptions>

const count = new Intl.NumberFormat(NUMBERS, {maximumFractionDigits: 0})
const compactCount = new Intl.NumberFormat(NUMBERS, {maximumFractionDigits: 1, notation: 'compact'})
const fraction = new Intl.NumberFormat(NUMBERS, {maximumFractionDigits: 1})
const usd = new Intl.NumberFormat(NUMBERS, {
	currency: 'USD',
	maximumFractionDigits: 2,
	minimumFractionDigits: 2,
	style: 'currency'
})

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

// A measured span: "120 ms", "1.5 s", "42 s", "3 min", "1.2 h". Each bound sits where rounding would reach the next unit, so 59.6 s reads 1 min, not 60 s.
export function durationOf(duration: Duration.Duration) {
	const ms = Duration.toMillis(duration)
	if (ms < 999.5) return `${Number.round(ms, 0)} ms`
	if (ms < 9950) return `${Number.round(ms / 1000, 1)} s`
	if (ms < 59_500) return `${Number.round(ms / 1000, 0)} s`
	if (ms < 3_570_000) return `${Number.round(ms / 60_000, 0)} min`
	return `${Number.round(ms / 3_600_000, 1)} h`
}

// A running or remaining time on a timer face, as m:ss.
export function timerOf(duration: Duration.Duration) {
	const seconds = Number.max(0, Math.floor(Duration.toSeconds(duration)))
	return `${Math.floor(seconds / 60)}:${String.padStart(2, '0')(`${seconds % 60}`)}`
}

// The time of day: "15:28", or to the second or millisecond where a trace needs it.
export function clockOf(at: DateTime.DateTime, unit: 'millisecond' | 'minute' | 'second' = 'minute') {
	return inZone(at, CLOCKS[unit])
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

// A month: "Nov 2026".
export function monthOf(at: DateTime.DateTime) {
	return inZone(at, {month: 'short', year: 'numeric'})
}

export function countOf(value: number) {
	return count.format(value)
}

// A count that may run large: "980", "1.2K", "3.4M".
export function compactCountOf(value: number) {
	return compactCount.format(value)
}

// A size to one decimal in its largest binary unit: "151.3 MiB", "10.7 GiB".
export function bytesOf(value: number) {
	if (value >= 1024 ** 4) return `${fraction.format(value / 1024 ** 4)} TiB`
	if (value >= 1024 ** 3) return `${fraction.format(value / 1024 ** 3)} GiB`
	return `${fraction.format(value / 1024 ** 2)} MiB`
}

export function percentOf(value: number) {
	return `${fraction.format(value)}%`
}

// Dollars to the cent; a cost too small to round to a cent still reads as more than nothing.
export function usdOf(value: number) {
	if (value > 0 && value < 0.01) return '<$0.01'
	return usd.format(value)
}
