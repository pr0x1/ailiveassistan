# AI Live Sales Assistant — CLAUDE.md

## Project Overview

**AI Live Sales Assistant** is a React + TypeScript web app that enables real-time voice conversations with a SAP Order-to-Cash (OTC) process assistant. It connects to Google Gemini Live API for live audio streaming and to a SAP MCP (Model Context Protocol) server for SAP data retrieval.

The assistant activates only when the user says "Amy" and only answers OTC-related questions.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build**: Vite 7
- **AI (Voice)**: `@google/genai` — Gemini 2.5 Flash Native Audio (Live API, WebSocket)
- **AI (UI)**: `@google/genai` — Gemini 2.5 Flash `generateContent` with JSON mode
- **MCP**: `@modelcontextprotocol/sdk` — StreamableHTTP transport
- **UI Protocol**: A2UI v0.8 — agent-to-UI visual rendering
- **Styling**: CSS Modules

## Project Structure

```
src/
├── App.tsx                        # Root component — wires hooks to UI, split-view layout
├── components/
│   ├── A2UIPanel.tsx              # A2UI visualization container (empty/generating/active/error states)
│   ├── A2UIPanel.module.css       # Panel styles + skeleton shimmer
│   ├── A2UIRenderer.tsx           # Renders A2UI surfaces — walks component adjacency list
│   ├── A2UIRenderer.module.css    # Renderer styles (Card, Row, Column, Text, etc.)
│   ├── ChatWindow.tsx             # Displays messages (voice, tool, system)
│   ├── Controls.tsx               # Start/End conversation buttons + text input
│   ├── StatusIndicator.tsx        # Visual state indicator (IDLE/LISTENING/PROCESSING/SPEAKING)
│   └── VoiceSelector.tsx          # Dropdown for 8 Gemini voices
├── hooks/
│   ├── useA2UIAgent.ts            # UI Agent hook — generateContent JSON mode → A2UI surfaces
│   ├── useGeminiLive.ts           # Main hook — manages Gemini Live session + audio
│   ├── useMcpClient.ts            # MCP connection + tool discovery + execution
│   └── useAudioState.ts           # App state machine (IDLE → LISTENING → etc.)
├── prompts/
│   ├── a2ui-instruction.md        # System prompt for the UI Agent (A2UI generation)
│   └── system-instruction.md      # Editable system prompt for the assistant (Amy)
├── types/
│   └── index.ts                   # All shared TypeScript types (incl. A2UI Protocol v0.8)
└── utils/
    ├── a2uiSchema.ts              # JSON Schema for Gemini generateContent (A2UI output)
    ├── audioConfig.ts             # Env vars, voice/state constants, config
    ├── mcpToolConverter.ts        # MCP ↔ Gemini tool format conversion
    └── promptLoader.ts            # Loads .md prompts at runtime

public/
└── audio-processor.js            # AudioWorklet processor (16kHz PCM capture)

docs/
├── CHANGELOG-a2ui.md             # A2UI integration changelog and bug tracker
└── plans/                        # Design docs and implementation plans
```

## Environment Variables

Required in `.env` (never commit this file):

```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
VITE_MCP_SERVER_URL=https://your-sap-mcp-server.com   # production only
```

In **development**, MCP traffic is proxied via Vite (`/api/mcp` → SAP BTP endpoint). The proxy target is configured in `vite.config.ts`.

## Development Commands

```bash
npm run dev       # Start dev server on port 5173
npm run build     # TypeScript check + Vite production build
npm run lint      # ESLint check
npm run preview   # Preview production build
```

## Key Architecture Decisions

### Audio Pipeline
- **Input**: AudioWorklet at 16kHz (`audio-processor.js`) → PCM base64 → `sendRealtimeInput()`
- **Output**: Gemini sends PCM chunks → decoded to `AudioBuffer` at 24kHz → chained playback
- Two separate `AudioContext` instances: input (16kHz) and output (24kHz)

### Transcription
- Both `inputAudioTranscription` and `outputAudioTranscription` are enabled on the session config
- Fragments are **accumulated** into the last matching message (not overwritten)

### MCP Tool Execution
- `useMcpClient` auto-connects on mount with up to 3 retries
- `convertMcpToolsToGemini()` in `mcpToolConverter.ts` converts MCP schemas to Gemini `FunctionDeclaration` format
- Tool execution status (start/result/error) is shown inline in the chat via `system`-role messages

### System Instruction
- Stored in `src/prompts/system-instruction.md` (easy to edit without touching code)
- Loaded at conversation start via `getValidatedSystemInstruction()` from `promptLoader.ts`

### Dual-Agent Pattern (A2UI)
Two Gemini agents work in parallel:
- **Voice Agent** (Gemini Live API, WebSocket): handles audio I/O, transcription, and tool calls to SAP MCP
- **UI Agent** (Gemini 2.5 Flash, `generateContent` with JSON mode): receives tool responses and generates A2UI v0.8 JSON to visualize the data

Flow: User speaks → Voice Agent calls SAP tool → tool response fires `onToolResponse` callback → UI Agent generates A2UI JSON → `A2UIRenderer` renders React components.

The `onToolResponse` callback uses a `useRef` pattern (`onToolResponseRef`) to avoid stale closures in the WebSocket handler. See `useGeminiLive.ts`.

### A2UI Rendering
- `useA2UIAgent` calls `generateContent` with `responseMimeType: 'application/json'` and the schema from `a2uiSchema.ts`
- The response is parsed into `A2UISurface` objects (component adjacency list + data model + styles)
- `A2UIRenderer` walks the adjacency list from root, recursively rendering React elements
- Supports 11 component types: Column, Row, Text, Card, List, Button, TextField, Image, Icon, Divider, CheckBox, DateTimeInput
- The `a2ui-instruction.md` prompt contains few-shot examples (Spanish + English) to guide generation

### State Machine
Four states: `IDLE` → `LISTENING` → `PROCESSING` → `SPEAKING`
Managed by `useAudioState.ts`, driven by WebSocket events and tool call lifecycle.

## Important Files to Know

| File | Purpose |
|------|---------|
| `src/prompts/system-instruction.md` | Edit to change assistant behavior/persona |
| `src/prompts/a2ui-instruction.md` | Edit to change UI Agent behavior/few-shot examples |
| `vite.config.ts` | Proxy config for MCP server (dev) |
| `src/utils/audioConfig.ts` | All constants, env var accessors |
| `src/utils/a2uiSchema.ts` | JSON schema constraining UI Agent output |
| `src/hooks/useGeminiLive.ts` | Core session logic — audio + tool handling |
| `src/hooks/useA2UIAgent.ts` | UI Agent — generateContent + A2UI surface parsing |
| `src/components/A2UIRenderer.tsx` | A2UI component tree renderer (handles Gemini flattening) |
| `public/audio-processor.js` | Must be in `public/` for AudioWorklet to load |
| `docs/CHANGELOG-a2ui.md` | A2UI integration changelog and bug tracker |

## Coding Conventions

- All hooks in `src/hooks/`, components in `src/components/`, types in `src/types/index.ts`
- CSS Modules only — no global styles except `index.css`
- Prefer `useCallback` for all functions passed as props or used in `useEffect` deps
- Use `useRef` for values that need to persist across renders without triggering re-renders (session, audio nodes, flags)
- Log with prefixes: `[Gemini Live]`, `[MCP]`, `[DEBUG]` for easy filtering
- Spanish strings in UI messages (`🔧 Ejecutando herramienta...`) are intentional — SAP context is bilingual

## Common Gotchas

1. **MCP must be connected before starting conversation** — `startConversation()` returns early if `mcpConnected` is false
2. **AudioWorklet file must be in `public/`** — it's loaded via `./audio-processor.js` at runtime, not bundled by Vite
3. **React Strict Mode** causes double-mount; `useMcpClient` uses `isConnecting` ref to prevent duplicate connections
4. **Session ref pattern** — `sessionRef` mirrors `session` state to avoid stale closures inside WebSocket callbacks
5. **Voice change restarts session** — changing voice during an active conversation calls `endConversation()` then `startConversation()` after 1s delay
6. **Gemini JSON flattening** — when `responseMimeType: 'application/json'` and a schema field is `type: Type.OBJECT` without nested properties, Gemini flattens nested keys (e.g., `children.explicitList` → `children_explicitList`, `text.literalString` → `text_literalString`). `A2UIRenderer.tsx` has workarounds: `resolveChildIds()`, `resolveChildId()`, `extractBoundValue()`
7. **onToolResponse stale closure** — the `onToolResponse` callback in `useGeminiLive` must use a `useRef` pattern (`onToolResponseRef`) because the WebSocket `onmessage` handler captures the initial closure. Without the ref, the callback is `undefined` when the handler fires
8. **CSS color inheritance in A2UI panel** — the app root sets `color: white` for the purple gradient background. The A2UI panel (white background) needs explicit `color: #333` to avoid invisible text
