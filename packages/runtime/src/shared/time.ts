// fallow-ignore-file unused-type -- Codecs expose their decoded types to consuming apps.
import {DateTime, Duration, Schema, SchemaGetter, pipe} from 'effect'

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
