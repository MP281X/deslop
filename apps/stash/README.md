# Stash

Set `STASH_PROXY`, the upstream media proxy, in `~/.deslop/stash.env`, since its URL carries credentials. Every read of a source exits through it, so sites never see the server's address.
