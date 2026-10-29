import {Effect, Schema} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {Job} from '#services/game/schema.ts'

// Where a unit is in its step: choosing the next, on its way, at work, finished (the world then applies what it did) or stuck for a while.
export const Tasks = Machine.make({
	branches: {
		arrive: {done: {target: 'Done'}, working: {target: 'Working'}},
		work: {done: {target: 'Done'}, working: {update: 'Working'}}
	},
	events: Machine.events({
		// It got there; the work there takes this long.
		Arrive: {seconds: Schema.Finite},
		Block: {reason: Schema.String, until: Schema.Int},
		Plan: {job: Job},
		// Its order changed or something interrupted it: it chooses again.
		Reset: {},
		Retry: {},
		Work: {seconds: Schema.Finite}
	}),
	root: Machine.state({
		states: {
			Done: {fields: {job: Job}},
			Planning: {},
			Stuck: {fields: {reason: Schema.String, until: Schema.Int}},
			Travelling: {fields: {job: Job}},
			Working: {fields: {job: Job, left: Schema.Finite}}
		}
	})
}).handle({
	initial: {target: 'Planning'},
	on: {
		Block: {data: transition => ({reason: transition.event.reason, until: transition.event.until}), target: 'Stuck'},
		Reset: {target: 'Planning'}
	},
	states: {
		Done: {on: {Plan: {data: transition => ({job: transition.event.job}), target: 'Travelling'}}},
		Planning: {on: {Plan: {data: transition => ({job: transition.event.job}), target: 'Travelling'}}},
		Stuck: {on: {Retry: {target: 'Planning'}}},
		Travelling: {
			on: {
				Arrive: {
					branches: 'arrive',
					resolve: transition => {
						if (transition.event.seconds <= 0) return transition.select.done({data: {job: transition.state.job}})
						return transition.select.working({data: {job: transition.state.job, left: transition.event.seconds}})
					}
				}
			}
		},
		Working: {
			on: {
				Work: {
					branches: 'work',
					resolve: transition => {
						const left = transition.state.left - transition.event.seconds
						if (left <= 1e-9) return transition.select.done({data: {job: transition.state.job}})
						return transition.select.working({data: {job: transition.state.job, left}})
					}
				}
			}
		}
	}
})
export type Task = Machine.Snapshot<typeof Tasks>
export type TaskEvent = Machine.Machine.EventInputOf<Machine.Machine.Events<typeof Tasks>>

// A construction site's progress: trees and rocks in its footprint cleared, its items brought, then built; a site with no work left is built when its items are in.
export const Sites = Machine.make({
	branches: {
		supplied: {complete: {target: 'Complete'}, constructing: {target: 'Constructing'}},
		work: {complete: {target: 'Complete'}, constructing: {update: 'Constructing'}}
	},
	events: Machine.events({Cleared: {}, Supplied: {seconds: Schema.Finite}, Work: {seconds: Schema.Finite}}),
	root: Machine.state({
		states: {Clearing: {}, Complete: {}, Constructing: {fields: {left: Schema.Finite}}, Supplying: {}}
	})
}).handle({
	initial: {target: 'Clearing'},
	states: {
		Clearing: {on: {Cleared: {target: 'Supplying'}}},
		Complete: {},
		Constructing: {
			on: {
				Work: {
					branches: 'work',
					resolve: transition => {
						const left = transition.state.left - transition.event.seconds
						if (left <= 1e-9) return transition.select.complete()
						return transition.select.constructing({data: {left}})
					}
				}
			}
		},
		Supplying: {
			on: {
				Supplied: {
					branches: 'supplied',
					resolve: transition => {
						if (transition.event.seconds <= 0) return transition.select.complete()
						return transition.select.constructing({data: {left: transition.event.seconds}})
					}
				}
			}
		}
	}
})
export type Site = Machine.Snapshot<typeof Sites>
export type SiteEvent = Machine.Machine.EventInputOf<Machine.Machine.Events<typeof Sites>>

// The states a world starts its units and sites in: a unit choosing, a site to clear, and a Home already built.
export const START_STATES = Effect.gen(function* () {
	const clearing = (yield* Machine.planInitial(Sites)).state
	return {
		built: (yield* Machine.plan(Sites, (yield* Machine.plan(Sites, clearing, {_tag: 'Cleared'})).next, {
			_tag: 'Supplied',
			seconds: 0
		})).next,
		clearing,
		planning: (yield* Machine.planInitial(Tasks)).state
	}
})
