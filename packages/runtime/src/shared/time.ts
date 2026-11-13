// fallow-ignore-file unused-type -- Codecs expose their decoded types to consuming apps.
import {DateTime, Duration, Schema, SchemaGetter, pipe} from 'effect'

// Some upstreams and SQL REAL columns carry fractional milliseconds.
export type DateTimeUtcFromFiniteMillis = typeof DateTimeUtcFromFiniteMillis.Type
export const DateTimeUtcFromFiniteMillis = pipe(
	Schema.Finite,
	Schema.decodeTo(Schema.DateTimeUtc, {
		decode: SchemaGetter.transform(value => DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => value)),
		encode: SchemaGetter.transform(DateTime.toEpochMillis)
	})
)

export type DurationFromFiniteMillis = typeof DurationFromFiniteMillis.Type
export const DurationFromFiniteMillis = pipe(Schema.Finite, Schema.decodeTo(Schema.DurationFromMillis))

export type DateTimeUtcFromFiniteSeconds = typeof DateTimeUtcFromFiniteSeconds.Type
export const DateTimeUtcFromFiniteSeconds = pipe(
	Schema.Finite,
	Schema.decodeTo(Schema.DateTimeUtc, {
		decode: SchemaGetter.transform(seconds => DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => seconds * 1000)),
		encode: SchemaGetter.transform(at => DateTime.toEpochMillis(at) / 1000)
	})
)

export type DateTimeUtcFromSeconds = typeof DateTimeUtcFromSeconds.Type
export const DateTimeUtcFromSeconds = pipe(
	Schema.Int,
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
