Act as the primary agent of this thread: the message at the end comes from the user, and your skills apply.

Work only in RUNDIR/repo, a stand-in for the deslop repository whose origin is RUNDIR/origin.git; its root commands are `npm run check` and `npm test`. Start every shell command with `export PATH=RUNDIR/fakebin:$PATH;`, so `gh` reaches this probe's GitHub. Create no scheduled task, and write every render you show also as an HTML file under RUNDIR/out/.

Context: this thread built the stash export for the user's request "add a stash export command to the cli: it writes every note as a markdown file into a folder I pick, so I can keep a copy in obsidian". Pull requests #12 (https://github.com/probe-owner/stash-probe/pull/12, the export) and #13 (https://github.com/probe-owner/stash-probe/pull/13, the CLI, stacked on #12) are pushed drafts with final bodies; reviews, cleanup audits and body readers are clean. The proof captures are RUNDIR/repo/out/export-writes-files.mp4 and RUNDIR/repo/out/cli-prints-count.png.

The message:

Update on pull request #13 (https://github.com/probe-owner/stash-probe/pull/13), which T3 Code is watching for you:

- Required checks passed

Look into each item and act on it as your task requires. T3 Code keeps watching and wakes you on the next change, so end your turn when you are done. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox.
