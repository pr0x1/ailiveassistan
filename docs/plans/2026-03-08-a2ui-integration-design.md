# A2UI Integration Design — AI Live Sales Assistant

**Date**: 2026-03-08
**Status**: Approved
**Goal**: Add real-time visual UI (A2UI protocol v0.8) alongside Amy's voice responses

---

## Problem

Amy responds only via voice. Users want to see visual representations (tables, cards, forms) that support what Amy says — especially when SAP tool data is returned.

## Architecture: Dual-Agent Pattern

Two parallel Gemini calls per tool response:

| Agent | Technology | Modality | Purpose |
|-------|-----------|----------|---------|
| Voice Agent | Gemini Live WebSocket | Audio | Real-time voice conversation |
| UI Agent | Gemini Flash `generateContent` | JSON | A2UI JSONL generation |

**Why two agents**: Gemini Live only supports TEXT *or* AUDIO per session, not both. A separate `generateContent` call with `responseMimeType: 'application/json'` guarantees valid JSON output for A2UI.

**Trigger**: UI Agent fires when MCP tool response is received (not on turnComplete). This is simpler, faster, and more robust — the UI appears while Amy is still speaking.

## Flow

```
User speaks → Gemini Live processes audio
  → Gemini Live makes tool call
    → MCP executes on SAP → returns data
      ├─→ sendToolResponse (Gemini Live continues speaking)
      └─→ generateUI (UI Agent generates A2UI JSON, in parallel)
            → A2UIRenderer renders components in right panel
```

## Layout: Split-View

```
┌──────────────────────────────────────────────────┐
│  Header (StatusIndicator + VoiceSelector)         │
├────────────────────┬─────────────────────────────┤
│   Chat Panel       │   A2UI Panel                │
│   (flex: 1)        │   (flex: 1)                 │
│   ChatWindow       │   A2UIRenderer              │
│   Controls         │   Renders surfaces           │
├────────────────────┴─────────────────────────────┤
│  Footer Controls (text input + buttons)           │
└──────────────────────────────────────────────────┘
```

A2UI Panel states:
- **Empty**: "Las visualizaciones aparecerán aquí"
- **Generating**: Skeleton/loading animation
- **Active**: Rendered A2UI components
- Each new tool response replaces the previous surface

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/useA2UIAgent.ts` | Hook: calls `generateContent` with JSON mode, manages surfaces |
| `src/components/A2UIPanel.tsx` | Right panel container |
| `src/components/A2UIRenderer.tsx` | Parses A2UI JSON → renders React components |
| `src/components/A2UIPanel.module.css` | Panel styles |
| `src/components/A2UIRenderer.module.css` | Component styles |
| `src/prompts/a2ui-instruction.md` | System prompt for UI Agent (schema + few-shot examples) |
| `src/utils/a2uiSchema.ts` | JSON Schema for `responseJsonSchema` in generateContent |

## Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Split-view layout with A2UI panel |
| `src/App.module.css` | Grid/flex for split-view |
| `src/hooks/useGeminiLive.ts` | After tool response → call `generateUI()` in parallel |
| `src/types/index.ts` | A2UI types: `A2UISurface`, `A2UIComponent`, `A2UIMessage` |

## Unchanged Files

- `src/hooks/useMcpClient.ts`
- `src/components/ChatWindow.tsx`
- `src/components/Controls.tsx`
- `src/components/VoiceSelector.tsx`
- `src/components/StatusIndicator.tsx`

## Hook: useA2UIAgent

```typescript
interface UseA2UIAgentReturn {
  generateUI: (toolName: string, toolData: unknown) => Promise<void>;
  surfaces: Map<string, A2UISurface>;
  isGenerating: boolean;
  error: string | null;
  clearSurfaces: () => void;
}
```

- Model: `gemini-2.5-flash` (standard, not Live)
- `responseMimeType: 'application/json'`
- `responseJsonSchema`: A2UI simplified schema
- System instruction: A2UI prompt with few-shot examples per SAP tool type
- User content: `"Tool: {toolName}\nData: {JSON.stringify(toolData)}"`

## A2UIRenderer — Component Mapping

| A2UI Component | React Element |
|----------------|---------------|
| `Column` | `<div>` flex column |
| `Row` | `<div>` flex row |
| `Text` | `<p>`, `<h1>`-`<h5>` by `usageHint` |
| `Card` | `<div className="a2ui-card">` |
| `List` | `<ul>` with template rendering |
| `Button` | `<button>` → `userAction` |
| `TextField` | `<input type="text">` |
| `Image` | `<img>` |
| `Icon` | `<span>` icon |
| `Divider` | `<hr>` |
| `CheckBox` | `<input type="checkbox">` |
| `DateTimeInput` | `<input type="date">` |

Data binding: local data model Map. Paths (`/user/name`) resolve against model. Components with `path` binding update reactively.

## Integration Point in useGeminiLive

```
// Current flow:
toolCall → executeToolCall(MCP) → toolResponse → sendToolResponse(Gemini Live)

// New flow:
toolCall → executeToolCall(MCP) → toolResponse
  ├─→ sendToolResponse(Gemini Live)   // voice continues
  └─→ generateUI(toolName, toolData)  // A2UI visual (fire-and-forget)
```

Both operations fire in parallel. UI Agent does not block voice response.

## A2UI Protocol Compliance

- Follows A2UI v0.8 standard catalog
- Messages: `surfaceUpdate`, `dataModelUpdate`, `beginRendering`, `deleteSurface`
- Adjacency list model (flat component list with ID references)
- BoundValue patterns: `literalString`, `path`, both
- userAction support for interactive components
