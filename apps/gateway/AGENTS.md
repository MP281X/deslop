# Gateway intent

- **AI.** Each person saves one key per provider: OpenCode for catalogue and Go, Anthropic for Claude, and OpenAI for its API. Show keys before servers in one table, without a separator. Key rows do not open anything. Show the provider's mark and name, masked key, sparkline and payer figure (Zen balance, Anthropic key or OpenAI key). Do not count OpenCode calls with no reported payer. Mark estimated or incomplete spend with `~`.
- **Actions.** Do not repeat an action if it might already have happened.
- **Excluded.** Tabs, a detail pane, a charts card, an app breakdown, a summary line, an Add server button or dialog.
- **Paste.** Use only the field under the bar to add or replace a key or add a server URL. The credential dialog submits the new secret. It does not ask for a second confirmation.
