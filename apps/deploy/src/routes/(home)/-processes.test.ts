import {assert, it} from '@effect/vitest'

import {Array, Option, String} from 'effect'

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {Processes} from '#routes/(home)/-processes.tsx'
import type {ProcessNode} from '#services/inventory/lib/utils.ts'

function node(props: {children?: readonly ProcessNode[]; name: string; pid: number}) {
	return {
		children: props.children ?? [],
		label: {detail: '', name: props.name},
		memory: 1024 ** 2,
		pid: props.pid,
		small: false
	}
}

const app = node({children: [node({name: 'child', pid: 2}), node({name: 'sibling', pid: 3})], name: 'app', pid: 1})

it('renders the processes as one tree whose rows nest by level', () => {
	const html = renderToStaticMarkup(createElement(Processes, {tree: [app]}))
	assert.include(html, 'role="tree"')
	assert.match(html, /aria-level="1"/u)
	assert.match(html, /aria-level="2"/u)
	assert.include(html, '<div role="group" class="pl-3">')
	assert.lengthOf(Array.fromIterable(Option.getOrElse(String.match(/role="treeitem"/gu)(html), () => [])), 3)
})

it('pins a parent row while its children scroll under it, and leaves a leaf unpinned', () => {
	const html = renderToStaticMarkup(createElement(Processes, {tree: [app]}))
	assert.lengthOf(
		Option.getOrElse(String.match(/<div class="tree-sticky">/gu)(html), () => []),
		1
	)
	assert.lengthOf(
		Option.getOrElse(String.match(/class="bg-background /gu)(html), () => []),
		1
	)
	assert.match(html, /<div class="tree-sticky"><div[^>]*aria-level="1"/u)
	assert.notMatch(html, /<div class="tree-sticky"><div[^>]*aria-level="2"/u)
})
