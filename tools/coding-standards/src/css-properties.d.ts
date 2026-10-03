export {}

declare module 'react' {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- React accepts CSS custom properties in style only through this interface augmentation.
	interface CSSProperties {
		// oxlint-disable-next-line typescript/consistent-indexed-object-style -- the augmentation merges this member into React's interface, which a Record type cannot do.
		[property: `--${string}`]: string
	}
}
