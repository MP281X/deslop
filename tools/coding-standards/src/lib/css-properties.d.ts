// oxlint-disable-next-line unicorn/require-module-specifiers -- the empty export makes this a module, so the block below augments React's types instead of replacing them.
export {}

declare module 'react' {
	interface CSSProperties {
		// oxlint-disable-next-line typescript/consistent-indexed-object-style -- the augmentation merges this member into React's interface, which a Record type cannot do.
		[property: `--${string}`]: number | string
	}
}
