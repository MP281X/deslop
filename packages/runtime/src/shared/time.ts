// fallow-ignore-file unused-type -- Codecs expose their decoded types to consuming apps.
import {DateTime, Duration, Schema, SchemaGetter, pipe} from 'effect'

export type TimeFrame = typeof TimeFrame.Type
export const TimeFrame = Schema.Literals(['10m', '1h', '24h', '7d', '30d'])

const TIME_FRAME_DURATIONS: Record<TimeFrame, Duration.Duration> = {
	'1h': Duration.hours(1),
	'7d': Duration.days(7),
	'10m': Duration.minutes(10),
	'24h': Duration.days(1),
	'30d': Duration.days(30)
}

export function timeFrameDuration(frame: TimeFrame) {
	return TIME_FRAME_DURATIONS[frame]
}

// Some upstreams and SQL REAL columns carry fractional milliseconds.
export type DateTimeUtcFromFiniteMillis = typeof DateTimeUtcFromFiniteMillis.Type
export const DateTimeUtcFromFiniteMillis = pipe(
	Schema.Finite.check(Schema.isBetween({maximum: 8.64e15, minimum: -8.64e15})),
	Schema.decodeTo(Schema.DateTimeUtc, {
		decode: SchemaGetter.transform(value => DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => value)),
		encode: SchemaGetter.transform(DateTime.toEpochMillis)
	})
)

export type DurationFromFiniteMillis = typeof DurationFromFiniteMillis.Type
export const DurationFromFiniteMillis = pipe(Schema.Finite, Schema.decodeTo(Schema.DurationFromMillis))

export type DateTimeUtcFromFiniteSeconds = typeof DateTimeUtcFromFiniteSeconds.Type
export const DateTimeUtcFromFiniteSeconds = pipe(
	Schema.Finite.check(Schema.isBetween({maximum: 8.64e12, minimum: -8.64e12})),
	Schema.decodeTo(Schema.DateTimeUtc, {
		decode: SchemaGetter.transform(seconds => DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => seconds * 1000)),
		encode: SchemaGetter.transform(at => DateTime.toEpochMillis(at) / 1000)
	})
)

export type DateTimeUtcFromSeconds = typeof DateTimeUtcFromSeconds.Type
export const DateTimeUtcFromSeconds = pipe(
	Schema.Int.check(Schema.isBetween({maximum: 8.64e12, minimum: -8.64e12})),
	Schema.decodeTo(Schema.DateTimeUtc, {
		decode: SchemaGetter.transform(value => DateTime.makeUnsafe(value * 1000)),
		encode: SchemaGetter.transform(DateTime.toEpochSeconds)
	})
)

export type DurationFromSeconds = typeof DurationFromSeconds.Type
export const DurationFromSeconds = pipe(
	Schema.Finite,
	Schema.decodeTo(Schema.Duration, {
		decode: SchemaGetter.transform(Duration.seconds),
		encode: SchemaGetter.transform(Duration.toSeconds)
	})
)
