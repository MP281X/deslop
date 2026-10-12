Act as the primary agent of this thread: the message at the end comes from the user, and your skills apply.

Work only in RUNDIR/repo, a stand-in for the deslop repository whose origin is RUNDIR/origin.git; its root commands are `npm run check` and `npm test`. Start every shell command with `export PATH=RUNDIR/fakebin:$PATH;`, so `gh` reaches this probe's GitHub. Create no scheduled task, and write every render you show also as an HTML file under RUNDIR/out/.

Context: this thread delivered the stash export for the user's request "add a stash export command to the cli: it writes every note as a markdown file into a folder I pick, so I can keep a copy in obsidian". Pull request #12 (https://github.com/probe-owner/stash-probe/pull/12, branch t3/export) holds it and is ready for review; the user has not merged it.

The message:

also put each note's tags in a yaml frontmatter at the top of the exported file
