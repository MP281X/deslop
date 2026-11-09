import {question} from '#lib/question.ts'

export const noImpossibleState = question(
	'code',
	'Does `code` model one thing’s state with several booleans or optional fields that can combine into states that should never exist?',
	{
		message: 'Use one discriminated union with one case per real state.',
		no: {
			cases: [
				'Independent settings that really combine, such as muted and pinned',
				'A discriminated union or status field with one value per state',
				'A Result, Option, Exit or machine state from a library',
				'State a library owns that `code` only reads'
			],
			example: `
				function useUpload() {
					const [upload, setUpload] = useState<
						{_tag: 'Idle'} | {_tag: 'Uploading'} | {_tag: 'Failed'; reason: string} | {_tag: 'Done'; url: string}
					>({_tag: 'Idle'})
					return {setUpload, upload}
				}
			`
		},
		yes: {
			cases: [
				'Separate flags such as loading, failed and done for one process',
				'Optional data and error fields for one result that could both be set, or both be empty'
			],
			example: `
				function useUpload() {
					const [uploading, setUploading] = useState(false)
					const [failed, setFailed] = useState(false)
					const [url, setUrl] = useState<string>()
					return {failed, setFailed, setUploading, setUrl, uploading, url}
				}
			`
		}
	}
)
