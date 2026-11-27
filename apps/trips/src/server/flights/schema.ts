import {Schema, pipe} from 'effect'

import {PlaceCode, ReservationStatus} from '#contracts'

// Times as the ticket prints them: local "2026-10-28T16:40", or with an offset when the source gives one.
export type LocalTime = typeof LocalTime.Type
export const LocalTime = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/u)),
	Schema.annotate({description: 'ISO date and time, local to the place unless the source gives an offset'})
)

export type TripNumber = typeof TripNumber.Type
export const TripNumber = Schema.String.check(Schema.isPattern(/^\d+$/u))

export type Short = typeof Short.Type
// What a ticket prints in a few words, bounded so a misread field cannot outgrow the Live Activity's 4 KB update.
export const Short = Schema.String.check(Schema.isMaxLength(40))
export type Name = typeof Name.Type
export const Name = Schema.String.check(Schema.isMaxLength(120))

export type ExtractedFlight = typeof ExtractedFlight.Type
export const ExtractedFlight = Schema.Struct({
	airlineCode: Short.annotate({description: 'IATA airline designator, such as BA or FR'}),
	airlineName: Name,
	arrival: LocalTime,
	boarding: Schema.OptionFromOptionalKey(LocalTime),
	confirmation: Schema.OptionFromOptionalKey(Short),
	departure: LocalTime,
	flightNumber: TripNumber.annotate({description: 'Digits only, such as 553'}),
	from: Short.annotate({description: 'IATA airport code'}),
	status: ReservationStatus,
	to: Short.annotate({description: 'IATA airport code'}),
	travellers: Schema.Array(
		Schema.Struct({
			boardingGroup: Schema.OptionFromOptionalKey(Short),
			name: Name.annotate({description: 'Given names then family name, without titles, such as Matteo Rossi'}),
			seat: Schema.OptionFromOptionalKey(Short),
			ticket: Schema.OptionFromOptionalKey(
				Short.annotate({description: "The passenger's e-ticket number, such as 125 2345678901"})
			)
		})
	).annotate({description: 'Every passenger the text names for this flight'})
})

export type ExtractedFlights = typeof ExtractedFlights.Type
export const ExtractedFlights = Schema.Array(ExtractedFlight)

export type FlightExtraction = typeof FlightExtraction.Type
export const FlightExtraction = Schema.Struct({flights: ExtractedFlights})

// What migration 0005 reads of a flight saved when each ticket was a row of its own.
export type LegacyFlight = typeof LegacyFlight.Type
export const LegacyFlight = Schema.Struct({
	airlineCode: Schema.String,
	departs: Schema.DateTimeUtcFromMillis,
	id: Schema.String,
	number: Schema.String,
	origin: Schema.String,
	timeZone: Schema.String
})

export type Airport = typeof Airport.Type
export const Airport = Schema.Struct({
	city: Schema.String,
	iata: PlaceCode,
	icao: Schema.String,
	lat: Schema.Finite,
	lon: Schema.Finite,
	name: Schema.String,
	tz: Schema.String
})
