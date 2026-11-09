import {question} from '#lib/question.ts'

export const noRepeatedFact = question(
	'component',
	'Does `code` render the same value or status as visible text twice at the same time?',
	{
		message: 'Show each fact once; drop the repeat.',
		no: {
			cases: [
				'The same value in branches that never render together',
				'A tooltip or hover detail, even one repeating the visible value exactly',
				'An icon beside the name it stands for, or a severity marker beside a specific reason',
				'Values passed to imported components, where `code` does not show both rendered as text',
				'A label only screen readers read'
			],
			example: `
				function Header(props: {count: number}) {
					return (
						<header>
							<h1>Notes</h1>
							<Badge>{props.count}</Badge>
						</header>
					)
				}
			`
		},
		yes: {
			cases: [
				'The same count, name, date or status written out twice in one view, such as in a heading and again in a badge',
				'Two visible text labels stating the same status'
			],
			example: `
				function Header(props: {count: number}) {
					return (
						<header>
							<h1>{props.count} notes</h1>
							<Badge>{props.count}</Badge>
						</header>
					)
				}
			`
		}
	}
)
