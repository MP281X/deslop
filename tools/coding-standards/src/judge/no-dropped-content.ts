import {question} from '#lib/question.ts'

export const noDroppedContent = question(
	'component',
	'Does `code` replace content it already loaded with an error or empty state when a later refresh fails?',
	{
		message: 'Keep the last loaded content and mark it stale; show the error alone only when nothing has loaded.',
		no: {
			cases: [
				'A first load that fails with no earlier value',
				'An authorization failure, which must clear the content',
				'An error shown beside the kept content, such as a marker or a banner',
				'A component that only renders a value it is given'
			],
			example: `
				function Prices() {
					const prices = useQuery(pricesQuery)
					if (prices.data === undefined) return prices.error ? <LoadFailed /> : <PricesSkeleton />
					return <PriceTable prices={prices.data} stale={prices.error !== null} />
				}
			`
		},
		yes: {
			cases: [
				'Rendering only an error when the latest result failed, while an earlier successful value is still available',
				'Clearing a list or detail when a refetch fails'
			],
			example: `
				function Prices() {
					const prices = useQuery(pricesQuery)
					if (prices.error) return <LoadFailed />
					if (prices.data === undefined) return <PricesSkeleton />
					return <PriceTable prices={prices.data} />
				}
			`
		}
	}
)
