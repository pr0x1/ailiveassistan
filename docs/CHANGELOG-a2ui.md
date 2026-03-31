# A2UI Integration — Changelog

> Feature: Real-time visual UI (A2UI protocol v0.8) alongside Amy's voice responses
> Started: 2026-03-08
> Design doc: `docs/plans/2026-03-08-a2ui-integration-design.md`
> Implementation plan: `docs/plans/2026-03-08-a2ui-integration.md`

---

## 2026-03-10 — A2UI v0.8 Spec Compliance

### Type Updates (`src/types/index.ts`)
- **Fixed**: `Icon` type changed from `{ icon: string }` to `{ name: A2UIBoundValue }` (per A2UI v0.8 spec)
- **Added**: `primary?: boolean` to `Button` type
- **Added**: `validationRegexp?: string` to `TextField` type
- **Added**: 4 new component types: `Tabs`, `Modal`, `MultipleChoice`, `Slider`
- `distribution` and `alignment` on Row/Column were already present

### Icon Bug Fix (`A2UIRenderer.tsx`)
- **Root cause**: Renderer read `iconDef.icon` but spec defines the property as `name` (BoundValue)
- **Fix**: Reads `name` first (spec-compliant), falls back to `icon` for backward compatibility with existing Gemini output

### Row/Column Distribution & Alignment (`A2UIRenderer.tsx`)
- **Added**: `DISTRIBUTION_MAP` — maps `start|center|end|spaceBetween|spaceAround|spaceEvenly` → CSS `justify-content`
- **Added**: `ALIGNMENT_MAP` — maps `start|center|end|stretch` → CSS `align-items`
- **Added**: `buildLayoutStyle()` helper merges distribution/alignment with existing flex style
- Applied to both Column and Row components

### Markdown in Text (`A2UIRenderer.tsx`)
- **Added**: `renderMarkdown()` helper — parses `**bold**`, `*italic*`, `` `code` ``, `[text](url)` into React elements
- Applied to all Text component output (no external library, regex-based)
- **Added**: `.inlineCode` CSS class for inline code styling

### 4 New Components (`A2UIRenderer.tsx`, `A2UIRenderer.module.css`)
- **TabsComponent**: Tab bar + content area, local `useState` for active tab, renders tab titles from BoundValue
- **ModalComponent**: Entry point child (rendered normally) triggers overlay with content child; backdrop/close button to dismiss
- **MultipleChoiceComponent**: Checkbox (multi) or radio (single, when `maxAllowedSelections=1`) selection; tracks selections locally
- **SliderComponent**: `<input type="range">` with min/max/value display

### CSS (`A2UIRenderer.module.css`)
- Added styles for: `.inlineCode`, `.tabs`, `.tabBar`, `.tabButton`, `.tabButtonActive`, `.tabContent`, `.modalOverlay`, `.modalContent`, `.modalClose`, `.multipleChoice`, `.choiceOption`, `.choiceOptionSelected`, `.slider`, `.sliderInput`, `.sliderValue`

### Build Verification
- `npm run build` passes — no TypeScript errors

---

## 2026-03-09 — Runtime Bug Fixes (Testing Phase)

### Bug 1: `Cannot read properties of undefined (reading 'explicitList')`
- **File**: `src/components/A2UIRenderer.tsx`
- **Root cause**: Gemini's `generateContent` with `responseMimeType: 'application/json'` **flattens nested keys** when `component` is declared as `type: Type.OBJECT` without inner structure in the schema. So `children: { explicitList: [...] }` becomes `children_explicitList: [...]`.
- **Fix**: Added `resolveChildIds()` helper that handles 4 formats:
  1. `{ children: { explicitList: [...] } }` — standard A2UI
  2. `{ children_explicitList: [...] }` — Gemini flattened
  3. `{ children: [...] }` — simplified array
  4. `{ children: "single_id" }` — single string
- Added `resolveChildId()` for single-child components (Card, Button).

### Bug 2: Panel empty after tool response (no error, no crash)
- **File**: `src/hooks/useGeminiLive.ts`
- **Root cause**: Stale closure. The `options?.onToolResponse` callback was captured at hook creation time. By the time the WebSocket `onmessage` handler fired (after tool execution), the closure was stale and the callback was undefined.
- **Fix**: Added `onToolResponseRef = useRef(options?.onToolResponse)` updated on every render. The WebSocket handler reads from `onToolResponseRef.current` instead of the captured `options`.

### Bug 3: White text on white background (invisible content)
- **Files**: `src/components/A2UIRenderer.tsx`, `A2UIRenderer.module.css`, `A2UIPanel.tsx`, `A2UIPanel.module.css`
- **Root cause**: The app's root `.app` class applies `color: white` for the purple gradient background. The A2UI panel (white background) inherited this color, making all text invisible.
- **Fix**: Added explicit `color: #333` via CSS classes and inline styles on the panel, content area, and renderer root.

### Bug 4: Text components render but are empty (`<p>` tags with no content)
- **File**: `src/components/A2UIRenderer.tsx`
- **Root cause**: Same Gemini flattening issue. `text: { literalString: "..." }` becomes `text_literalString: "..."`. The renderer was reading `def.Text.text` which returned `undefined`.
- **Fix**: Created `extractBoundValue()` helper that checks both nested and flattened formats:
  - `def.text` — nested object `{ literalString: "..." }`
  - `def.text_literalString` — flattened string
  - `def.text_literalNumber` — flattened number
  - `def.text_path` — flattened path binding
  - `def.text` as plain string — direct value
- Applied to ALL component types (Text, TextField, Image, CheckBox, etc.)
- Updated `resolveBoundValue()` to also handle plain string/number inputs.

### Bug 5: English conversations don't generate UI (Spanish works)
- **File**: `src/prompts/a2ui-instruction.md`
- **Root cause**: System prompt only had Spanish examples and instructed "Use Spanish labels where appropriate". When user conversed in English, the model produced UI that didn't match expected patterns or was deprioritized.
- **Fix**:
  1. Added English few-shot example (Single Order Detail in English)
  2. Changed language instruction to: *"Detect the language from the user prompt context. If the prompt or tool name appears to be in English, use English labels. If in Spanish, use Spanish labels. Default to Spanish if ambiguous."*
- **Status**: Applied but **not yet tested**

---

## 2026-03-08 — Initial Implementation (Tasks 1-9)

### Task 1: A2UI type definitions
- **File modified**: `src/types/index.ts`
- Added A2UI Protocol v0.8 types: `A2UIBoundValue`, `A2UIChildren`, `A2UIAction`, `A2UIComponentDef`, `A2UIComponentEntry`, `A2UIDataContent`, `A2UISurfaceUpdate`, `A2UIDataModelUpdate`, `A2UIBeginRendering`, `A2UIDeleteSurface`, `A2UIMessage`, `A2UISurface`, `UseA2UIAgentReturn`

### Task 2: JSON Schema for generateContent
- **File created**: `src/utils/a2uiSchema.ts`
- Schema constrains UI Agent output to valid A2UI v0.8 messages
- Uses Gemini's `Type` enum (not standard JSON Schema `$ref/$defs`)
- **Known limitation**: `component` property is `type: Type.OBJECT` without nested structure, which causes Gemini to flatten nested keys (see Bug 1 above)

### Task 3: A2UI system prompt
- **File created**: `src/prompts/a2ui-instruction.md`
- Loadable via existing `loadPrompt('a2ui-instruction')` pattern
- Contains output rules, UI template rules, and few-shot SAP OTC examples

### Task 4: useA2UIAgent hook
- **File created**: `src/hooks/useA2UIAgent.ts`
- Manages the UI Agent: initializes GoogleGenAI, loads system prompt, calls `generateContent` with JSON mode
- Model: `gemini-2.5-flash`
- Parses A2UI messages into renderable `A2UISurface` objects
- Returns: `{ generateUI, surfaces, isGenerating, error, clearSurfaces }`

### Task 5: A2UIRenderer component
- **Files created**: `src/components/A2UIRenderer.tsx`, `src/components/A2UIRenderer.module.css`
- Walks component adjacency list from root, recursively renders React elements
- Supports all 11 A2UI component types: Column, Row, Text, Card, List, Button, TextField, Image, Icon, Divider, CheckBox, DateTimeInput
- Resolves BoundValue (literal + data model path bindings)

### Task 6: A2UIPanel container
- **Files created**: `src/components/A2UIPanel.tsx`, `src/components/A2UIPanel.module.css`
- Container with 4 states: empty, generating (skeleton shimmer), active (rendered surfaces), error
- Header: "Visualización SAP"

### Task 7: Split-view layout
- **Files modified**: `src/App.tsx`, `src/styles/App.module.css`
- Chat panel on left, A2UI panel on right (50/50 flex)
- Responsive: stacks vertically on mobile (< 768px)
- Max-width increased from 1200px to 1600px

### Task 8: Wire useA2UIAgent into useGeminiLive
- **Files modified**: `src/hooks/useGeminiLive.ts`, `src/App.tsx`
- Added `onToolResponse` callback parameter to `useGeminiLive`
- After `sendToolResponse`, fires `onToolResponse` for each successful (non-error) tool result
- `useA2UIAgent()` called before `useGeminiLive()` in App.tsx, `generateUI` passed as callback

### Task 9: Build verification
- `npm run build` passed successfully

---

## Current Status

| Item | Status |
|------|--------|
| Spanish UI rendering | Working |
| English UI rendering | Fix applied, untested |
| A2UI v0.8 spec compliance | 15/16 components implemented (Video & AudioPlayer excluded by design) |
| Icon property name | Fixed (`name` per spec, `icon` fallback) |
| Row/Column distribution/alignment | Implemented |
| Markdown in Text | Implemented (bold, italic, code, links) |
| New components (Tabs, Modal, MultipleChoice, Slider) | Implemented, untested at runtime |
| Debug console.log statements | Present — needs cleanup before commit |
| Git commits | None made yet |
| Build | Passes |

## Files Changed (Summary)

### New Files
| File | Purpose |
|------|---------|
| `src/types/index.ts` (appended) | A2UI Protocol v0.8 type definitions |
| `src/utils/a2uiSchema.ts` | JSON Schema for Gemini generateContent |
| `src/prompts/a2ui-instruction.md` | System prompt for UI Agent |
| `src/hooks/useA2UIAgent.ts` | UI Agent hook (generateContent JSON mode) |
| `src/components/A2UIRenderer.tsx` | A2UI surface renderer |
| `src/components/A2UIRenderer.module.css` | Renderer styles |
| `src/components/A2UIPanel.tsx` | Panel container component |
| `src/components/A2UIPanel.module.css` | Panel styles |

### Modified Files
| File | Change |
|------|--------|
| `src/App.tsx` | Split-view layout, wired useA2UIAgent + useGeminiLive |
| `src/styles/App.module.css` | Added splitView, chatPanel, a2uiContainer classes |
| `src/hooks/useGeminiLive.ts` | Added onToolResponse callback with ref pattern |

## Known Issues / Technical Debt

1. **Gemini JSON flattening**: The `component` field in `a2uiSchema.ts` is `type: Type.OBJECT` without nested properties. This causes Gemini to flatten keys like `children.explicitList` → `children_explicitList`. The `A2UIRenderer` has workarounds (`resolveChildIds`, `extractBoundValue`) but the schema could potentially be improved.
2. **Debug logging**: `console.log` statements in `A2UIRenderer.tsx` and `useA2UIAgent.ts` should be removed before production.
3. **Component type safety**: The renderer casts `def.Text`, `def.Column`, etc. as `Record<string, unknown>` to handle Gemini's flattened output, losing TypeScript type safety.
