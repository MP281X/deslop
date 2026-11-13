import {Boolean, DateTime} from 'effect'

// "21 Oct" this year, "21 Oct 2025" before it.
export function shortDate(date: DateTime.Utc) {
	return DateTime.formatLocal(
		date,
		Boolean.match(DateTime.getPartUtc(date, 'year') === DateTime.getPartUtc(DateTime.nowUnsafe(), 'year'), {
			onFalse: () => ({day: 'numeric', month: 'short', year: 'numeric'}) as const,
			onTrue: () => ({day: 'numeric', month: 'short'}) as const
		})
	)
}
