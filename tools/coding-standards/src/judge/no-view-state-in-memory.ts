import {matches} from '#lib/ast.ts'
import {question} from '#lib/question.ts'

// Widgets whose open item, tab or range is a view, and the props that keep it uncontrolled.
const VIEW_WIDGETS =
	/Tab|Select|Toggle|Accordion|Collapsible|Segment|Radio|Picker|Combobox|Filter|Sort|Range|Calendar|Pane|Resizable|Sidebar|Disclosure|Carousel|Pagination|Menubar|default[A-Z]|uncontrolled/u
const NATIVE = /from ['"](?:react-native[\w/-]*|expo[\w/-]*|@expo\/[\w/-]+|@deslop\/components-mobile[\w/-]*)['"]/u

export const noViewStateInMemory = question(
	'component',
	'Does `code`, a web page, keep which item, tab, pane, filter or range it shows in component state instead of the URL? A native screen has no URL.',
	{
		// State lives in a hook or behind a widget; a native screen has no URL to keep it in.
		gate: unit => (unit.hooks || matches(VIEW_WIDGETS)(unit.text)) && !matches(NATIVE)(unit.imports),
		message: 'Keep the view in the URL, so reload, back and shared links restore it.',
		no: {
			cases: [
				'Transient input: an open dialog or menu, hover, focus, a draft being typed',
				'State inside a reusable widget rather than a page',
				'Values already read from the URL or router',
				'Native screens that use native navigation instead of URLs, including their selection and filters'
			],
			example: `
				function Notes() {
					const search = Route.useSearch()
					const navigate = Route.useNavigate()
					return <NoteList selected={search.selected} onSelect={id => navigate({search: {selected: id}})} />
				}
			`
		},
		yes: {
			cases: [
				'useState holding the selected item, active tab, open pane, sort, filter or date range of a page',
				'A view a reload or shared link would lose'
			],
			example: `
				function Notes() {
					const [selected, setSelected] = useState<string>()
					return <NoteList selected={selected} onSelect={setSelected} />
				}
			`
		}
	}
)
