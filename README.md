# Foosball for Claude Code

Table foosball in a Claude Code pane: a 5-rank CPU ladder, trophies, and an office league over the local network.

## Install

```
claude plugin marketplace add mlardier/foosball-claude-mod
claude plugin install foosball@claude-foosball
```

Update later with `claude plugin marketplace update claude-foosball`, then `/reload-plugins`.

Then in a session: `/foosball`.

## Office league (same network only)

- `/foosball office`: lobby, open tables, leaderboard
- `/foosball host`: open a table; colleagues see it in their lobby
- `/foosball join IP:PORT`: join by address when discovery is blocked
- `/foosball name NICK`: your league name

Needs `node` on PATH. While the pane is open the mod runs `bridge/bridge.mjs`, which announces your name and rating on UDP port 47474 and, while hosting, accepts one TCP connection. Closing the pane stops it. League data lives in `~/.claude/foosball/`. macOS may ask to allow incoming connections for node when you host.
