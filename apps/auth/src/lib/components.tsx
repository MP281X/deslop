import {avatarClass, initials} from '#lib/utils.ts'

// The header and the People page show an account as its initials on a square of its own color.
export function Avatar(props: {id: string; name: string}) {
	return (
		<span
			className={`text-background grid size-7 shrink-0 place-items-center text-xs font-semibold ${avatarClass(props.id)}`}
			aria-hidden="true"
		>
			{initials(props.name)}
		</span>
	)
}
