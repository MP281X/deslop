import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Match, Option, Struct, pipe} from 'effect'

import {GithubLogoIcon, GitlabLogoIcon, MapTrifoldIcon} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {useEffect} from 'react'

import {AppBar, AppBarChoice, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {useMediaQuery} from '@deslop/components-web/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {Search, snapshotAtom} from '#lib/utils.ts'
import type {View} from '#lib/utils.ts'
import {CoupleView} from '#routes/(home)/-couple.tsx'
import {DetailPane} from '#routes/(home)/-detail.tsx'
import {FlowView} from '#routes/(home)/-flow.tsx'
import {MapView} from '#routes/(home)/-map.tsx'
import icon from '#routes/icon.svg'
import type {PullRequest, RepoState} from '#services/changes/schema.ts'

const VIEWS = [
	{label: 'Map', value: 'map'},
	{label: 'Flow', value: 'flow'},
	{label: 'Couple', value: 'couple'}
] satisfies readonly {label: string; value: View}[]

const route = getRouteApi('/(home)/')

// The first load: the map's own geometry, so the page keeps its shape while the repositories answer.
function PageSkeleton() {
	return (
		<div aria-label="Pull requests" className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
			{Array.makeBy(6, index => (
				<div key={index} className="border p-2">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="mt-2 h-4 w-2/3" />
					<Skeleton className="mt-1 h-3 w-1/3" />
				</div>
			))}
		</div>
	)
}

// One repository tab: its provider's mark, its name, and a problem dot when its last fetch failed.
function RepoTabs(props: {repos: readonly RepoState[]; value: string}) {
	return (
		<AppBarTabs value={props.value}>
			{Array.map(props.repos, state => (
				<AppBarTab
					key={state.repo.id}
					value={state.repo.id}
					render={
						<Link
							to="/"
							title={state.problem ?? state.repo.id}
							search={previous => ({...Struct.omit(previous, ['pane', 'pr']), repo: state.repo.id})}
							onClick={event => {
								if (state.repo.id === props.value) event.preventDefault()
							}}
						/>
					}
				>
					<span className="flex items-center gap-1.5">
						{Boolean.match(state.repo.provider === 'github', {
							onFalse: () => <GitlabLogoIcon aria-hidden className="size-3.5" />,
							onTrue: () => <GithubLogoIcon aria-hidden className="size-3.5" />
						})}
						<span className="text-xs">{state.repo.name}</span>
						{Option.match(Option.fromUndefinedOr(state.problem), {
							onNone: () => null,
							onSome: problem => (
								<span role="img" className="flex items-center" aria-label={problem} title={problem}>
									<StatusDot status="warning" />
								</span>
							)
						})}
					</span>
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

// The three answers, chosen once in the bar.
function ViewTabs(props: {onChange: (view: View) => void; value: View}) {
	return (
		<AppBarChoice
			label="View"
			value={props.value}
			options={VIEWS}
			onChange={next => {
				Option.map(
					Array.findFirst(VIEWS, entry => entry.value === next),
					entry => props.onChange(entry.value)
				)
			}}
		/>
	)
}

function ViewOf(props: {
	now: number
	onSelect: (pr: PullRequest) => void
	pullRequests: readonly PullRequest[]
	selected?: PullRequest
	view: View
}) {
	return pipe(
		Match.value(props.view),
		Match.when('flow', () => (
			<FlowView now={props.now} onSelect={props.onSelect} pullRequests={props.pullRequests} selected={props.selected} />
		)),
		Match.when('couple', () => (
			<CoupleView onSelect={props.onSelect} pullRequests={props.pullRequests} selected={props.selected} />
		)),
		Match.orElse(() => (
			<MapView onSelect={props.onSelect} pullRequests={props.pullRequests} selected={props.selected} />
		))
	)
}

// The chosen repository's answer in the wide pane, its pull request beside it; the reader may resize the split.
function Workspace(props: {
	now: number
	onSelect: (pr: PullRequest) => void
	state: RepoState
	selected?: PullRequest
	view: View
}) {
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel minSize={480}>
				<div className="flex h-full min-h-0 flex-col">
					<ScrollArea className="min-h-0 flex-1">
						<ViewOf
							now={props.now}
							onSelect={props.onSelect}
							pullRequests={props.state.pullRequests}
							selected={props.selected}
							view={props.view}
						/>
					</ScrollArea>
				</div>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel defaultSize={380} maxSize={560} minSize={280}>
				<DetailPane pr={props.selected} />
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

function Home() {
	const isMobile = useMediaQuery('(width < 64rem)')
	const navigate = route.useNavigate()
	const search: Search = route.useSearch()
	const snapshot = useAtomValue(snapshotAtom)
	const refresh = useAtomRefresh(snapshotAtom)
	const value = AsyncResult.value(snapshot)
	const blockingFailure = Option.filter(AsyncResult.cause(snapshot), () => Option.isNone(value))
	const repos = Option.getOrElse(
		Option.map(value, current => current.repos),
		() => Array.empty<RepoState>()
	)
	const repo = Option.getOrUndefined(
		Option.orElse(
			Option.flatMap(Option.fromUndefinedOr(search.repo), id => Array.findFirst(repos, state => state.repo.id === id)),
			() => Array.head(repos)
		)
	)
	const view = search.view ?? 'map'
	const pullRequests = Option.getOrElse(
		Option.map(Option.fromUndefinedOr(repo), state => state.pullRequests),
		() => Array.empty<PullRequest>()
	)
	const selected = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(search.pr), number =>
			Array.findFirst(pullRequests, pr => pr.number === number)
		)
	)
	const now = Option.getOrElse(
		Option.map(value, current => DateTime.toEpochMillis(DateTime.makeUnsafe(current.fetchedAt))),
		() => DateTime.toEpochMillis(DateTime.nowUnsafe())
	)
	const detail = isMobile && search.pane === 'files' && selected !== undefined

	// The URL names one repository; a first visit, or one whose repository disappeared, lands on the first tab.
	useEffect(() => {
		if (repo === undefined) return
		if (search.repo === repo.repo.id) return
		navigate({replace: true, search: previous => ({...previous, repo: repo.repo.id})})
	}, [navigate, repo, search.repo])

	// A pull request that left the list leaves the URL too; one still shown keeps its place.
	useEffect(() => {
		if (search.pr === undefined) return
		if (selected !== undefined) return
		if (Option.isNone(value)) return
		navigate({replace: true, search: previous => Struct.omit(previous, ['pane', 'pr'])})
	}, [navigate, search.pr, selected, value])

	function select(pr: PullRequest) {
		navigate({
			search: previous =>
				Boolean.match(isMobile, {
					onFalse: () => ({...Struct.omit(previous, ['pane']), pr: pr.number}),
					onTrue: () => ({...previous, pane: 'files' as const, pr: pr.number})
				})
		})
	}

	const controls = Boolean.match(detail, {
		onFalse: () => (
			<>
				<StaleProblem label="Out of date" readers={[snapshotAtom]} />
				{Boolean.match(repo !== undefined, {
					onFalse: () => null,
					onTrue: () => (
						<ViewTabs value={view} onChange={next => navigate({search: previous => ({...previous, view: next})})} />
					)
				})}
			</>
		),
		onTrue: () => <StaleProblem label="Out of date" readers={[snapshotAtom]} />
	})

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				heading={Boolean.match(detail, {
					onFalse: () => undefined,
					onTrue: () => ({
						back: {
							label: 'Pull requests',
							onClick: () => navigate({search: previous => Struct.omit(previous, ['pane', 'pr'])})
						},
						title: Option.match(Option.fromUndefinedOr(repo), {
							onNone: () => 'Pull request',
							onSome: state => state.repo.name
						})
					})
				})}
				icon={icon}
				name="atlas"
				controls={controls}
				tabs={Boolean.match(detail || Array.isReadonlyArrayEmpty(repos), {
					onFalse: () => (
						<RepoTabs
							repos={repos}
							value={Option.getOrElse(
								Option.map(Option.fromUndefinedOr(repo), state => state.repo.id),
								() => ''
							)}
						/>
					),
					onTrue: () => undefined
				})}
			/>
			<main className="pb-safe-bottom relative flex min-h-0 flex-1 flex-col overflow-hidden">
				<h1 className="sr-only">Atlas</h1>
				{Option.match(blockingFailure, {
					onNone: () =>
						Option.match(value, {
							onNone: () => <PageSkeleton />,
							onSome: () =>
								Option.match(Option.fromUndefinedOr(repo), {
									onNone: () => <EmptyState label="No repositories" icon={<MapTrifoldIcon weight="light" />} />,
									onSome: state =>
										Boolean.match(detail, {
											onFalse: () =>
												Boolean.match(isMobile, {
													onFalse: () => (
														<Workspace now={now} onSelect={select} selected={selected} state={state} view={view} />
													),
													onTrue: () => (
														<ScrollArea className="min-h-0 flex-1">
															<ViewOf
																now={now}
																onSelect={select}
																pullRequests={state.pullRequests}
																selected={selected}
																view={view}
															/>
														</ScrollArea>
													)
												}),
											onTrue: () => <DetailPane pr={selected} />
										})
								})
						}),
					onSome: cause => <WebRuntime.Failure error={Cause.squash(cause)} reset={refresh} />
				})}
			</main>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
