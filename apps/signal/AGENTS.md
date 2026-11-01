# Signal: product intent

This file describes what Signal should become, not what its code currently implements. Keep it current whenever the user changes the idea: update the affected sections, remove superseded directions, and distinguish agreed rules from open questions. Do not turn an implementation shortcut or an agent's proposal into a product decision. Use this intent to decide what to keep, replace or delete; the repository's root instructions still own engineering conventions and commands.

## The simulation

Signal is a persistent, Factorio/Satisfactory-like factory simulation in a massive procedurally generated world. Multiple models run different teams, build factories, consume finite local resources, expand and eventually encounter one another. More models and teams should be possible over time; three teams is not a permanent limit.

The world continues while the user is away. The user watches, investigates and follows its evolution rather than micromanaging colonies. Interesting, unpredictable stories should emerge from individuals' decisions, incomplete information and shared physical consequences, not predetermined alliances, enemy labels or scripted betrayals.

Factory production, logistics, resource depletion, exploration and wildlife belong to the simulation. Wildlife is not disposable decoration: mobs are persistent individuals with state machines and decision models, capable of interacting with their environment and other entities.

## Core, units and decisions

- Each team's Core is a physical coordination point, like a king supervising an organization, not an omniscient god or a collective mind. It sets direction and influences units through information, objectives and priorities rather than deciding every operation.
- Units are independent. They act on local perceptions, experiences, received information and guidance. They need not have the same knowledge as the Core or one another, and they do not receive the team's full history.
- The Core can update the information and guidance available to particular units. It cannot rewrite their experiences or silently update units that did not receive or read the communication. It can overlook something, deem information unimportant or choose not to share it.
- Use decision models such as Jev heavily for bounded local decisions, reducing routine work for the longer-running team agents. State machines carry out actions between decisions; movement and production do not require inference on every tick. Models should receive only the knowledge available to the individual making the decision.
- The Core is a technological/cyberpunk coordination structure: dark alloy, visible circuitry and antennas, not a house or an old stone tower. Its exact detailing remains open.

## Reality, knowledge and memory

Keep authoritative world state, an individual's knowledge and the spectator's view separate. An event occurring does not automatically tell a team that it occurred.

- A unit knows what it perceives and what reaches it through communication. The Core learns through its own available observations, reports and radio pings, not direct access to the simulation's private state.
- Retain the distinction between direct observations, received claims, suspicions and stale information. A body proves a death was discovered, not who caused it. An absent unit is not automatically known to be dead.
- Do not maintain authoritative friendly, hostile or alliance classifications for agents. Their interpretations belong in their own experience and conversation history and can differ or be wrong. Physical ownership and identity must not imply trust, intent or access protection.
- Agent continuity comes from persistent history with automatic compaction, not a manual notes tool or a parallel agent-maintained memory/marker system. Long-running agents must survive context limits and process restarts without starting over intellectually.
- Compaction preserves relevant discoveries, goals, instructions, commitments, uncertainty and entity references, including how and when information was learned. It must not turn a report or suspicion into an established fact. Older original history remains available for retrieval and spectator inspection.
- Complete lifetime history is not the active decision context. Individuals use relevant retained experience and summaries, not an ever-growing transcript or everyone else's private thoughts.

## Discovery and communication between teams

Teams begin believing they are alone. Initial instructions must not reveal other teams or their ability to communicate with them.

The first direct encounter reveals that communication is possible. Thereafter, a team can know about and contact only teams it encountered directly or whose IDs another team supplied. Receiving an ID does not reveal that team's location, inventory, factory, thoughts or history. A unit's encounter does not automatically inform its Core: the knowledge must reach it.

Other teams' units are unfamiliar entities like any other mob, not automatically identified enemies or friends. Agents infer behaviour and choose how to respond. An encounter need not become a fight, a conversation or a report.

## Storage, cooperation and conflict

- Accessible containers and storage can be inspected and used by any team. No separate sharing or trade mechanism is needed merely to move resources between teams.
- A unit can find and empty storage without knowing who built it or ever meeting its team. The other team discovers the discrepancy when someone inspects the container, not through an automatic theft alert or remotely updated inventory.
- Remembered inventories and expected deliveries can be wrong. Neither the Core nor units get live global stock information merely because their team built a container.
- Combat uses ordinary actions against entities, not a special inter-team war mode. There is no alliance protection or friendly-fire immunity.
- Alliances are agreements and beliefs held by participants, not engine-enforced states. Allies can rob or kill one another and remain perceived allies until evidence or communication changes those beliefs.
- Explain the lack of ownership protection and alliance immunity explicitly in agent instructions when applicable, without spoiling undiscovered teams. The simulation provides capabilities and consequences; the models choose cooperation, aggression, restraint or deception.

## Radio and voluntary reporting

Communication is not continuous synchronization. Units choose when and what to report, including summaries of activities, observations, current circumstances and intentions. They may report an encounter and then die, or die without reporting it. The Core can contact individual units, but a message does not force a reply or compliance.

Radio coverage and antennas/repeaters make communication depend on infrastructure:

- A unit knows whether it is currently in coverage and may deliberately leave it, with or without telling the Core.
- Outside coverage, the Core has last-known information, not a live location or an explanation for silence.
- Within coverage, the Core can ping a unit's location independently of a conversational reply. Delivery, reading, replying and acting are distinct; none should be treated as proof of all the others.
- An incapacitated unit's intact, operational radio can still answer location pings. A ping proves radio contact, not life, health or willingness to respond. It must not expose cargo, thoughts or surrounding events.
- Repeated stationary pings and unanswered messages are evidence the Core may interpret and investigate, not an automatic death diagnosis. No response can have multiple causes, including loss of coverage or radio failure.
- A report conveys what was communicated, not the sender's entire private history. Returning to coverage permits reporting but does not force it or silently apply unread guidance.

Range, repeater costs, power requirements and other radio balancing details remain to be designed.

## Physical evidence and environment

Units and mobs leave traces of passage. Recent footprints, wheel tracks or disturbed vegetation can suggest direction, approximate freshness and the kind of body that passed. Repeated use accentuates wear into trails and flattened ground. Traces fade, overlap or become obscured rather than forming a permanent, perfectly readable movement log.

An individual can discover a body, inspect nearby traces and follow them to investigate. Evidence must not expose hidden entity IDs, affiliations or a guaranteed culprit. Following tracks to a factory can support a suspicion without proving who committed an act. The spectator's recorded truth is not evidence an investigator automatically receives.

Include a day/night cycle that affects the simulation, not just its lighting: reduced vision changes perception and investigation, and mobs and environmental interactions vary with time of day. Night is not a blanket hostility switch. Exact creature routines and lighting mechanics remain open.

Consequences are local but shared: resource depletion, smog and a creature's reaction to one team's actions can affect everyone nearby. Difficulty differs with each team's circumstances rather than a single global difficulty setting. Preserve those cross-team effects instead of isolating each team in its own progression bubble.

## Spectating, conversations and history

The spectator experience should make an evolving world understandable, including after hours away:

- World first: the user wants to visualize the simulation, not read a dashboard. The map owns the screen by default; inspecting an individual or opening a conversation reveals a contextual, dismissible panel. Do not reserve half the screen for an unopened inspector or show a permanent team statistics table.
- The approved minimal layout has no app bar or permanent Core/history buttons: one visible Run world / Pause world action and an overflow menu float over the map, with one compact timeline below. Put world events, Core conversations and usage in the overflow menu; reveal replay play/speed and the return-to-now action only while viewing history.
- Run/pause controls the authoritative world and model activity from the frontend, independently of replay. Pausing stops ticks and cancels unfinished requests; inspecting or scrubbing history must neither resume nor pause the world. A server restart follows its configured run mode, not a previous browser session.
- Keep historical navigation visible in a compact timeline matching the app's square, technical visual style. Scrubbing and event selection change the spectator's view, not the authoritative simulation. Avoid repeated clocks/statuses, rows of speed buttons and observation/usage clutter; secondary controls and detailed text are requested explicitly.
- Rework the timeline/replay experience around understanding what happened; do not preserve the current implementation merely because it exists.
- Allow inspection of each individual unit or mob from its beginning, including its decisions, actions and outcomes, with navigation to the relevant place and time.
- Keep world events and what each participant knew or believed distinguishable. The spectator can inspect the truth and individual perspectives without leaking omniscient data into agent contexts.
- Present reasoning collapsed by default but expandable, like T3 Code. Tool calls must show meaningful structured arguments and results rather than poorly formatted prose dumps.
- Resources, mobs, units, storage and positions in conversations and history should be clickable references that locate the actual subject on the map, including its historical context where relevant.
- History is not limited to team-level round transcripts or manually authored notes and markers. It must explain individual behaviour as well as factory and team developments.
- The web experience must work on mobile, with usable touch interaction; a native app is not the goal.

## Cost, performance and order of work

First align on this direction and clean up unused code and superseded concepts. Then make the web experience usable on mobile, followed by substantial performance optimization. The target is at least 10× better performance, demonstrated against explicit, repeatable baselines rather than claimed from code deletion or reduced simulation richness.

Long unattended runs must be affordable. Reduce repetitive context and unnecessary agent decisions, use decision models for suitable work, and measure actual usage, cache behaviour and billed cost rather than assume caching works or does not. Separate development usage from production usage. Compaction and economical decision contexts must not erase the uncertainty and individual experiences that make the simulation interesting.

Keep production Signal stopped until the user explicitly asks to resume it. Documentation, cleanup or development is not permission to restart the production simulation or its paid model activity.

## Still open

- Whether there is any ending or explicit victory condition. An indefinitely evolving simulation is the current leaning; adding teams over time is desirable, not a settled spawning or balancing policy.
- What long-term factory/technology progression and increasing challenge should look like. The existing endless Signal-cycle delivery counter is not an agreed endgame, and removing it has not yet been decided.
- The exact allocation of strategic and local decisions between team models, decision models and state machines; establish cost and behaviour with evidence rather than assume a model fits every choice.
- Detailed Core visuals, radio balancing, environmental effects and creature behaviour. Design these within the knowledge and agency rules above, not as excuses for new omniscient shortcuts.
