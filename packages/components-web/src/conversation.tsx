import {Array} from 'effect'

import {LegendList} from '@legendapp/list/react'

import {cn} from '#lib/utils.ts'

export function Conversation<T extends {id: string}>(props: {
	items: T[]
	children: (item: T, index: number) => React.ReactNode
	className?: string
}) {
	return (
		<LegendList<T>
			alignItemsAtEnd
			maintainScrollAtEnd
			maintainVisibleContentPosition
			data={props.items}
			recycleItems
			estimatedItemSize={240}
			keyExtractor={item => item.id}
			initialScrollIndex={Array.length(props.items) - 1}
			renderItem={input => props.children(input.item, input.index)}
			ListHeaderComponent={<div className="h-2" />}
			ListFooterComponent={<div className="h-2" />}
			className={cn('min-h-0 flex-1 overflow-x-hidden overscroll-y-contain', props.className)}
		/>
	)
}
