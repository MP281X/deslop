import {assert, it} from '@effect/vitest'

import {Array, Option, Schema} from 'effect'

import {FxConversation} from './contract.ts'
import {conversationExtraction, conversationPlan} from './x.ts'

function post(id: string, author: string, text: string, seconds: number) {
	return {
		author: {id: author, name: `Name ${author}`, screen_name: `user${author}`},
		created_timestamp: 1_700_000_000 + seconds,
		id,
		text
	}
}

const conversation = Schema.decodeSync(FxConversation)({
	replies: [
		{...post('2', 'a', 'A follow-up.', 2), replying_to: {status: '1'}},
		{...post('3', 'b', 'A question?', 3), likes: 4, replying_to: {status: '1'}},
		{...post('4', 'a', 'An answer.', 4), replying_to: {status: '3'}},
		{...post('5', 'c', 'Another reader.', 5), likes: 9, replying_to: {status: '1'}}
	],
	status: post('1', 'a', 'The saved post.', 1)
})

it('keeps the author’s follow-ups with the post, answers beside the question, and replies by likes', () => {
	const plan = conversationPlan(conversation, conversation.status, Option.none())
	const extraction = conversationExtraction(new URL('https://x.com/usera/status/1'), plan, {pages: [], posts: []})
	assert.strictEqual(extraction.title, 'Name a on X')
	assert.strictEqual(
		extraction.text,
		Array.join(
			[
				'**Name a (@usera)**: The saved post.',
				'A follow-up.',
				"## The author's answers to readers\n\n**Name b (@userb)** wrote: A question?\nThe author answered: An answer.",
				'## Replies\n\n**Name c (@userc)**, 9 likes: Another reader.\n\n**Name b (@userb)**, 4 likes: A question?'
			],
			'\n\n'
		)
	)
})
