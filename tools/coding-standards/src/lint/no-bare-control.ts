import {Array, Option, Record, String, pipe} from 'effect'

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

const FALLBACK_IMAGE =
	'An image with a fallback is an <Avatar>: <AvatarImage src={…} /> and <AvatarFallback>{…}</AvatarFallback> load and fall back without onError.'

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

function hasAttribute(node: ESTree.JSXOpeningElement, name: string) {
	return Array.some(
		node.attributes,
		attribute =>
			attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === name
	)
}

// A control's look and behaviour change only in its primitive, which a screen places.
export const noBareControl = defineRule({
	create: context => ({
		JSXOpeningElement: node => {
			if (node.name.type !== 'JSXIdentifier' || renderedBy(node.parent.parent)) return
			if (node.name.name === 'img' && hasAttribute(node, 'onError')) context.report({message: FALLBACK_IMAGE, node})
			if (node.name.name === 'form' && !String.includes('<FieldGroup')(context.sourceCode.getText(node.parent))) {
				context.report({
					message:
						"A form's fields sit in a <FieldGroup>, which spaces and labels them; the form itself takes no layout.",
					node
				})
			}
			pipe(
				MESSAGES,
				Record.get(node.name.name),
				Option.map(message => context.report({message, node}))
			)
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.tsx': `import {Button} from '@deslop/components-web/ui/button'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Field, FieldGroup, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
export function Save() { return <Button className="w-full" size="lg" render={<button type="button" aria-label="Save" />}>Save</Button> }
export function Face() { return <Avatar><AvatarImage src="/face.png" alt="" /><AvatarFallback>F</AvatarFallback></Avatar> }
export function Name() { return <form><FieldGroup><Field><FieldLabel htmlFor="name">Name</FieldLabel><Input id="name" /></Field></FieldGroup></form> }`
					}
				]
			}
		},
		type: 'problem'
	}
})
