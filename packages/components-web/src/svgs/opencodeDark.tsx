import type {SVGProps} from 'react'

const OpencodeDark = (props: SVGProps<SVGSVGElement>) => (
	<svg {...props} fill="none" viewBox="0 0 16 20">
		<title>OpenCode</title>
		<path d="M12 16H4V8H12V16Z" fill="currentColor" opacity="0.45" />
		<path d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="currentColor" />
	</svg>
)

export {OpencodeDark}
