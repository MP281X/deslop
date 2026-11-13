import {Array, Option, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

const MESSAGES: Record<string, string> = {
	a: 'Write a link as <Button variant="link" nativeButton={false} render={<a href={url} aria-label={label} />}>{label}</Button>; a raw <a> is only the render of a primitive.',
	button:
		'Write <Button onClick={…}>; a raw <button> is only the render of a primitive, as in <Item render={<button type="button" aria-label={label} />}>.',
	input: 'Write <Input>, or <InputGroupInput> inside an <InputGroup>; a raw <input> is only the render of a primitive.',
	select: 'Write <NativeSelect>, or <Select> for a styled list; a raw <select> is only the render of a primitive.',
	textarea: 'Write <Textarea>; a raw <textarea> is only the render of a primitive.'
}

// The expression wrappers a `render` value passes through before it reaches the element a primitive renders as.
const RENDER_PATHS = [
	'ArrowFunctionExpression',
	'BlockStatement',
	'ConditionalExpression',
	'FunctionExpression',
	'JSXExpressionContainer',
	'LogicalExpression',
	'ReturnStatement'
]

function renderedBy(node: ESTree.Node | null): boolean {
	if (node === null) return false
	if (node.type === 'JSXAttribute') return node.name.type === 'JSXIdentifier' && node.name.name === 'render'
	return Array.contains(RENDER_PATHS, node.type) && renderedBy(node.parent)
}

// A control's look and behaviour change only in its primitive, which a screen places.
export const noBareControl = defineRule({
	create: context => ({
		JSXOpeningElement: node => {
			if (node.name.type !== 'JSXIdentifier' || renderedBy(node.parent.parent)) return
			pipe(
				MESSAGES,
				Record.get(node.name.name),
				Option.map(message => context.report({message, node}))
			)
		}
	}),
	meta: {type: 'problem'}
})
