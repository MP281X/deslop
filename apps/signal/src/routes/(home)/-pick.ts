import {Array, Number, Option} from 'effect'

export function pickActor(
	actors: readonly {id: number; object: {visible: boolean; position: {x: number; y: number; z: number}}}[],
	project: (x: number, y: number, z: number) => {x: number; y: number},
	x: number,
	y: number
) {
	return Option.map(
		Array.head(
			Array.sort(
				Array.filter(
					Array.map(
						Array.filter(actors, actor => actor.object.visible),
						actor => {
							const point = project(actor.object.position.x, actor.object.position.y + 0.3, actor.object.position.z)
							return {distance: Math.hypot(point.x - x, point.y - y), id: actor.id}
						}
					),
					entry => entry.distance < 36
				),
				(a: {distance: number}, b: {distance: number}) => Number.sign(a.distance - b.distance)
			)
		),
		entry => entry.id
	)
}
