// Expo's native color boundary accepts sRGB, not OKLCH; these match theme.css in both appearances, and an app config hands them to native code that cannot import the theme.
export const palette = {
	colors: {
		background: {dark: '#09090b', light: '#ffffff'},
		border: {dark: '#27272a', light: '#e4e4e7'},
		card: {dark: '#18181b', light: '#ffffff'},
		destructive: {dark: '#ff5d62', light: '#c92b38'},
		foreground: {dark: '#fafafa', light: '#09090b'},
		mutedForeground: {dark: '#9f9fa9', light: '#71717b'},
		primaryForeground: {dark: '#09090b', light: '#ffffff'},
		surface: {dark: '#18181b', light: '#fafafa'},
		warning: {dark: '#ff9e3b', light: '#a3530b'}
	},
	hues: {
		amber: {dark: '#e6c384', light: '#91601d'},
		blue: {dark: '#7e9cd8', light: '#345dad'},
		cyan: {dark: '#a3d4d5', light: '#25777a'},
		ivory: {dark: '#dcd7ba', light: '#686868'},
		orange: {dark: '#ffa066', light: '#b64b11'},
		pink: {dark: '#d27e99', light: '#a63c69'},
		purple: {dark: '#957fb8', light: '#74519b'},
		slate: {dark: '#9cabca', light: '#526887'}
	}
}
