import {matches} from '#lib/ast.ts'
import {question} from '#lib/question.ts'

// Widgets whose open item, tab or range is a view, and the props that keep it uncontrolled.
const VIEW_WIDGETS =
	/Tab|Select|Toggle|Accordion|Collapsible|Segment|Radio|Picker|Combobox|Filter|Sort|Range|Calendar|Pane|Resizable|Sidebar|Disclosure|Carousel|Pagination|Menubar|default[A-Z]|uncontrolled/u
const NATIVE = /from ['"](?:react-native[\w/-]*|expo[\w/-]*|@expo\/[\w/-]+|@deslop\/components-mobile[\w/-]*)['"]/u

export const noViewStateInMemory = question(
	'component',
	'Does `code`, a web page, keep which item, tab, pane, filter or range it shows in component state instead of the URL?',
	{
		// State lives in a hook or behind a widget; a native screen has no URL to keep it in.
		gate: unit => (unit.hooks || matches(VIEW_WIDGETS)(unit.text)) && !matches(NATIVE)(unit.imports),
		message: 'Keep the view in the URL, so reload, back and shared links restore it.',
		no: {
			cases: [
				'Transient input does not select the page’s view.',
				'The page reads its selection from URL search parameters.'
			],
			example: `
				export function Notes(props: {search: {selected: string}}) {
					return <p>{props.search.selected}</p>
				}
			`
		},
		yes: {
			cases: ['Component state holds which part of a page is visible.', 'Reloading loses the page’s selection.'],
			example: `
				import {useState} from 'react'

				export function Notes(props: {render: (selected: string, select: (id: string) => void) => string}) {
					const [selected, setSelected] = useState('first')
					return props.render(selected, setSelected)
				}
			`
		}
	}
)
