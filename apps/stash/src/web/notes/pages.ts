import {Array, Schema} from 'effect'

// A page's path is its place in the pager and, for pictures, the server's route for it.
export type Page = typeof Page.Type
const Page = Schema.Struct({kind: Schema.Literals(['cover', 'image']), path: Schema.String})

// The pager's pages: the stored cover alone until the post's pictures are counted, then one page per picture. The cover is the post's first picture, so it stands for it and the phone downloads one fewer.
export function pagesOf(cover: boolean, id: string, count: number): readonly Page[] {
	if (count === 0) {
		if (!cover) return []
		return [Page.make({kind: 'cover', path: `${id}/cover`})]
	}
	return Array.makeBy(count, index => {
		const path = `${id}/media/${index}`
		if (cover && index === 0) return Page.make({kind: 'cover', path})
		return Page.make({kind: 'image', path})
	})
}
