# SavvyCal MCP Server

[![CI](https://github.com/OfirOhan/savvycal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OfirOhan/savvycal-mcp/actions/workflows/ci.yml)
![MCP](https://img.shields.io/badge/MCP-compatible-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **[SavvyCal](https://savvycal.com)**. It lets Claude, Cursor, ChatGPT and other AI agents find open times, book and cancel meetings, and manage your scheduling links.

> **Unofficial.** This is a community project and is not affiliated with SavvyCal. It was built from SavvyCal's public API docs.

## What you can ask your agent

- "Find three 30-minute slots on my **Intro call** link next week, in New York time, and draft an email offering them to Sam."
- "Book Dana (dana@acme.com, London) into the first Tuesday-morning slot on my **Demo** link."
- "What meetings do I have this week, and who are they with?"
- "Cancel tomorrow's 3pm and tell them I'm sick."
- "Turn off my **Office hours** link until further notice."

## Tools

| Tool | What it does | Writes? |
|---|---|---|
| `get_current_user` | Who am I (name, email, time zone) | No |
| `list_scheduling_links` | All links with durations and state | No |
| `get_scheduling_link` | One link's settings and booking form fields | No |
| `find_available_slots` | Bookable slots, **grouped by day with local times**, filterable by duration | No |
| `list_events` | Meetings by state, upcoming/past/date range, link | No |
| `get_event` | One meeting with attendees and conferencing info | No |
| `book_meeting` | Book a slot for someone (sends real invites) | Yes |
| `cancel_meeting` | Cancel a meeting (notifies attendees) | **Destructive** |
| `toggle_scheduling_link` | Enable or disable a link | Yes |
| `list_webhooks` / `create_webhook` / `delete_webhook` | Manage webhooks | Yes |

`find_available_slots` turns SavvyCal's raw slot list into something an LLM can reason about. It groups slots by day, shows them in any time zone (`10:00 AM–10:30 AM`), lists the available durations, and searches the next 7 days by default. Booking and cancelling tools carry MCP annotations, so clients can ask before running them.

## Setup

1. Create a personal access token at **[savvycal.com/developers](https://savvycal.com/developers)**.
2. Build it:

```bash
git clone https://github.com/OfirOhan/savvycal-mcp.git
cd savvycal-mcp && npm install && npm run build
```

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "savvycal": {
      "command": "node",
      "args": ["/absolute/path/to/savvycal-mcp/dist/index.js"],
      "env": { "SAVVYCAL_TOKEN": "pt_secret_..." }
    }
  }
}
```

### Claude Code / Cursor / other MCP clients

```bash
claude mcp add savvycal -e SAVVYCAL_TOKEN=pt_secret_... -- node /path/to/savvycal-mcp/dist/index.js
```

For Cursor and other clients, use the same command with `SAVVYCAL_TOKEN` in the environment.

| Variable | Default | Notes |
|---|---|---|
| `SAVVYCAL_TOKEN` | (required) | Personal access token, or an OAuth access token |
| `SAVVYCAL_BASE_URL` | `https://api.savvycal.com` | Override for testing |

## Development

```bash
npm install
npm test   # builds, runs unit tests and an end-to-end MCP stdio test against a fake SavvyCal API
```

The tests run on Node 20, 22 and 24 in CI.

## Author

Built by [Ofir Ohana](https://github.com/OfirOhan), an AI agents engineer. Issues and PRs are welcome.

## License

MIT
