# tldw

Paste a YouTube video URL, get an AI-generated outline with key insights, timestamps, and hook quotes. Click any outline item to jump to that moment in the embedded player.

Transcripts are extracted via yt-dlp, processed through Claude, and cached in SQLite.

## Stack

Next.js 15, React 19, Anthropic SDK, better-sqlite3, Tailwind, Fly.io

## Setup

```bash
bun install
bun run dev
```

Requires `ANTHROPIC_API_KEY` in `.env`.
