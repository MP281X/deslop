export type Note = {id: string; title: string; body: string; tags: string[]}

export const notes: Note[] = [
	{body: 'Atoms hold shared state.', id: 'a1', tags: ['effect', 'react'], title: 'Effect atoms'},
	{body: 'DataImpulse for TikTok and YouTube.', id: 'b2', tags: ['stash'], title: 'Proxy choice'}
]
