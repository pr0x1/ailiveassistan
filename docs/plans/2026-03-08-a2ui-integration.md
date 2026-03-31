# A2UI Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time visual UI (A2UI protocol v0.8) alongside Amy's voice responses using a dual-agent pattern — Voice Agent (Gemini Live) + UI Agent (Gemini Flash generateContent).

**Architecture:** Two parallel Gemini calls per tool response. Voice Agent continues the audio conversation via WebSocket while a separate UI Agent calls `generateContent` with `responseMimeType: 'application/json'` to produce A2UI JSONL. The A2UI output is rendered in a split-view panel next to the chat.

**Tech Stack:** React 19, TypeScript, `@google/genai` (already installed), CSS Modules, Vite 7.

**Design doc:** `docs/plans/2026-03-08-a2ui-integration-design.md`

---

### Task 1: Add A2UI types to `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts:125` (append at end)

**Step 1: Add A2UI type definitions**

Append these types at the end of `src/types/index.ts`:

```typescript
// ============================================
// A2UI Protocol v0.8 Types
// ============================================

// BoundValue — data binding for component properties
export interface A2UIBoundValue {
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
  literalArray?: string[];
  path?: string;
}

// Children reference — either explicit list or template
export interface A2UIChildren {
  explicitList?: string[];
  template?: {
    dataBinding: string;
    componentId: string;
  };
}

// Action — for Button components
export interface A2UIAction {
  name: string;
  context?: Array<{
    key: string;
    value: A2UIBoundValue;
  }>;
}

// Component type union — each component has exactly one key
export interface A2UIComponentDef {
  Column?: { children: A2UIChildren; distribution?: string; alignment?: string };
  Row?: { children: A2UIChildren; distribution?: string; alignment?: string };
  Text?: { text: A2UIBoundValue; usageHint?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body' };
  Card?: { child: string };
  List?: { children: A2UIChildren; direction?: 'vertical' | 'horizontal' };
  Button?: { child: string; action: A2UIAction };
  TextField?: { label: A2UIBoundValue; text: A2UIBoundValue; textFieldType?: string };
  Image?: { url: A2UIBoundValue; fit?: string; usageHint?: string };
  Icon?: { icon: string };
  Divider?: { axis?: 'horizontal' | 'vertical' };
  CheckBox?: { label: A2UIBoundValue; value: A2UIBoundValue };
  DateTimeInput?: { value: A2UIBoundValue; enableDate?: boolean; enableTime?: boolean };
}

// Single component entry in the adjacency list
export interface A2UIComponentEntry {
  id: string;
  weight?: number;
  component: A2UIComponentDef;
}

// Data model content entry
export interface A2UIDataContent {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: A2UIDataContent[];
}

// A2UI message types (JSONL messages)
export interface A2UISurfaceUpdate {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponentEntry[];
  };
}

export interface A2UIDataModelUpdate {
  dataModelUpdate: {
    surfaceId: string;
    path?: string;
    contents: A2UIDataContent[];
  };
}

export interface A2UIBeginRendering {
  beginRendering: {
    surfaceId: string;
    root: string;
    styles?: {
      font?: string;
      primaryColor?: string;
    };
  };
}

export interface A2UIDeleteSurface {
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | A2UISurfaceUpdate
  | A2UIDataModelUpdate
  | A2UIBeginRendering
  | A2UIDeleteSurface;

// Parsed surface ready for rendering
export interface A2UISurface {
  surfaceId: string;
  components: A2UIComponentEntry[];
  rootId: string;
  dataModel: Map<string, unknown>;
  styles?: {
    font?: string;
    primaryColor?: string;
  };
}

// Hook return type
export interface UseA2UIAgentReturn {
  generateUI: (toolName: string, toolData: unknown) => Promise<void>;
  surfaces: Map<string, A2UISurface>;
  isGenerating: boolean;
  error: string | null;
  clearSurfaces: () => void;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors (existing errors are OK)

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(a2ui): add A2UI protocol v0.8 type definitions"
```

---

### Task 2: Create A2UI JSON Schema for generateContent

**Files:**
- Create: `src/utils/a2uiSchema.ts`

**Step 1: Create the schema file**

Create `src/utils/a2uiSchema.ts`:

```typescript
/**
 * A2UI JSON Schema for Gemini generateContent responseJsonSchema.
 *
 * This schema constrains the UI Agent's output to valid A2UI v0.8 messages.
 * Used with responseMimeType: 'application/json' in generateContent calls.
 */

import { Type } from '@google/genai';

/**
 * Simplified A2UI schema compatible with Gemini responseJsonSchema.
 * Gemini's JSON mode requires the schema to use the Type enum,
 * not standard JSON Schema $ref/$defs.
 */
export const A2UI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    messages: {
      type: Type.ARRAY,
      description: 'Array of A2UI JSONL messages (surfaceUpdate, dataModelUpdate, beginRendering)',
      items: {
        type: Type.OBJECT,
        properties: {
          surfaceUpdate: {
            type: Type.OBJECT,
            description: 'Define or update UI components',
            properties: {
              surfaceId: { type: Type.STRING },
              components: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    weight: { type: Type.NUMBER },
                    component: { type: Type.OBJECT }
                  },
                  required: ['id', 'component']
                }
              }
            },
            required: ['surfaceId', 'components']
          },
          dataModelUpdate: {
            type: Type.OBJECT,
            description: 'Populate or update data model values',
            properties: {
              surfaceId: { type: Type.STRING },
              path: { type: Type.STRING },
              contents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    valueString: { type: Type.STRING },
                    valueNumber: { type: Type.NUMBER },
                    valueBoolean: { type: Type.BOOLEAN }
                  },
                  required: ['key']
                }
              }
            },
            required: ['surfaceId', 'contents']
          },
          beginRendering: {
            type: Type.OBJECT,
            description: 'Signal the client to start rendering',
            properties: {
              surfaceId: { type: Type.STRING },
              root: { type: Type.STRING },
              styles: {
                type: Type.OBJECT,
                properties: {
                  font: { type: Type.STRING },
                  primaryColor: { type: Type.STRING }
                }
              }
            },
            required: ['surfaceId', 'root']
          }
        }
      }
    }
  },
  required: ['messages']
};
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/utils/a2uiSchema.ts
git commit -m "feat(a2ui): add JSON schema for generateContent responseJsonSchema"
```

---

### Task 3: Create A2UI system prompt

**Files:**
- Create: `src/prompts/a2ui-instruction.md`

**Step 1: Create the prompt file**

Create `src/prompts/a2ui-instruction.md`:

```markdown
# A2UI Visual Generator — SAP OTC Data

You are a UI generation agent. Given a SAP tool name and its response data, you produce A2UI v0.8 JSON that visualizes the data as a rich interface.

## Output Rules

- Output ONLY the JSON object matching the schema. No markdown, no explanation.
- Every surface MUST have a surfaceUpdate, then optionally a dataModelUpdate, then a beginRendering.
- Use surfaceId "sap-data" for all surfaces.
- Component IDs must be unique within a surface.

## UI Template Rules

- **List of items** (orders, deliveries, invoices): Use Column > Text(h2 title) + List with Card template. Each card shows key fields in a Row layout.
- **Single record** (one order, one customer): Use Card > Column with labeled Text fields.
- **Error/empty data**: Use Card > Column > Icon("error") + Text explaining the issue.
- **Tabular data**: Use Column > Text(h2) + List of Row items. Each Row has Text fields for columns.

## SAP OTC Examples

### Sales Order List
Tool: get_sales_orders
```json
{"messages":[{"surfaceUpdate":{"surfaceId":"sap-data","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","order_list"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"Órdenes de Venta"},"usageHint":"h2"}}},{"id":"order_list","component":{"List":{"children":{"explicitList":["order_0","order_1"]},"direction":"vertical"}}},{"id":"order_0","component":{"Card":{"child":"order_0_content"}}},{"id":"order_0_content","component":{"Row":{"children":{"explicitList":["order_0_id","order_0_customer","order_0_total"]}}}},{"id":"order_0_id","weight":1,"component":{"Text":{"text":{"literalString":"SO-1001"}}}},{"id":"order_0_customer","weight":2,"component":{"Text":{"text":{"literalString":"Acme Corp"}}}},{"id":"order_0_total","weight":1,"component":{"Text":{"text":{"literalString":"$12,500.00"}}}},{"id":"order_1","component":{"Card":{"child":"order_1_content"}}},{"id":"order_1_content","component":{"Row":{"children":{"explicitList":["order_1_id","order_1_customer","order_1_total"]}}}},{"id":"order_1_id","weight":1,"component":{"Text":{"text":{"literalString":"SO-1002"}}}},{"id":"order_1_customer","weight":2,"component":{"Text":{"text":{"literalString":"Global Ltd"}}}},{"id":"order_1_total","weight":1,"component":{"Text":{"text":{"literalString":"$8,200.00"}}}}]}},{"beginRendering":{"surfaceId":"sap-data","root":"root","styles":{"primaryColor":"#1565C0"}}}]}
```

### Single Order Detail
Tool: get_sales_order_detail
```json
{"messages":[{"surfaceUpdate":{"surfaceId":"sap-data","components":[{"id":"root","component":{"Card":{"child":"detail"}}},{"id":"detail","component":{"Column":{"children":{"explicitList":["header","divider","fields"]}}}},{"id":"header","component":{"Text":{"text":{"literalString":"Orden de Venta SO-1001"},"usageHint":"h2"}}},{"id":"divider","component":{"Divider":{}}},{"id":"fields","component":{"Column":{"children":{"explicitList":["f_customer","f_date","f_status","f_total"]}}}},{"id":"f_customer","component":{"Row":{"children":{"explicitList":["lbl_customer","val_customer"]}}}},{"id":"lbl_customer","weight":1,"component":{"Text":{"text":{"literalString":"Cliente:"},"usageHint":"caption"}}},{"id":"val_customer","weight":2,"component":{"Text":{"text":{"literalString":"Acme Corp"}}}},{"id":"f_date","component":{"Row":{"children":{"explicitList":["lbl_date","val_date"]}}}},{"id":"lbl_date","weight":1,"component":{"Text":{"text":{"literalString":"Fecha:"},"usageHint":"caption"}}},{"id":"val_date","weight":2,"component":{"Text":{"text":{"literalString":"2026-03-08"}}}},{"id":"f_status","component":{"Row":{"children":{"explicitList":["lbl_status","val_status"]}}}},{"id":"lbl_status","weight":1,"component":{"Text":{"text":{"literalString":"Estado:"},"usageHint":"caption"}}},{"id":"val_status","weight":2,"component":{"Text":{"text":{"literalString":"En proceso"}}}},{"id":"f_total","component":{"Row":{"children":{"explicitList":["lbl_total","val_total"]}}}},{"id":"lbl_total","weight":1,"component":{"Text":{"text":{"literalString":"Total:"},"usageHint":"caption"}}},{"id":"val_total","weight":2,"component":{"Text":{"text":{"literalString":"$12,500.00"}}}}]}},{"beginRendering":{"surfaceId":"sap-data","root":"root","styles":{"primaryColor":"#1565C0"}}}]}
```

## Important

- Always produce valid JSON matching the responseJsonSchema.
- Use Spanish labels where appropriate (this is a bilingual SAP context).
- Keep component trees shallow — max 4 levels deep.
- Limit to 30 components per surface for performance.
```

**Step 2: Verify the file is loadable**

No runtime test needed — the prompt loader pattern (`loadPrompt('a2ui-instruction')`) is already proven.

**Step 3: Commit**

```bash
git add src/prompts/a2ui-instruction.md
git commit -m "feat(a2ui): add system prompt for UI Agent with SAP OTC examples"
```

---

### Task 4: Create `useA2UIAgent` hook

**Files:**
- Create: `src/hooks/useA2UIAgent.ts`

**Step 1: Create the hook**

Create `src/hooks/useA2UIAgent.ts`:

```typescript
import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { getApiKey } from '../utils/audioConfig';
import { loadPrompt } from '../utils/promptLoader';
import { A2UI_RESPONSE_SCHEMA } from '../utils/a2uiSchema';
import type { A2UISurface, A2UIComponentEntry, A2UIMessage, A2UIDataContent, UseA2UIAgentReturn } from '../types';

const UI_AGENT_MODEL = 'gemini-2.5-flash';

/**
 * Recursively convert A2UI dataModelUpdate contents to a Map.
 */
function contentsToMap(contents: A2UIDataContent[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const entry of contents) {
    if (entry.valueMap) {
      map.set(entry.key, contentsToMap(entry.valueMap));
    } else if (entry.valueString !== undefined) {
      map.set(entry.key, entry.valueString);
    } else if (entry.valueNumber !== undefined) {
      map.set(entry.key, entry.valueNumber);
    } else if (entry.valueBoolean !== undefined) {
      map.set(entry.key, entry.valueBoolean);
    }
  }
  return map;
}

/**
 * Hook that manages the A2UI UI Agent — a separate Gemini generateContent
 * call that produces A2UI JSON from tool response data.
 */
export function useA2UIAgent(): UseA2UIAgentReturn {
  const [surfaces, setSurfaces] = useState<Map<string, A2UISurface>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ai = useRef<GoogleGenAI | null>(null);
  const systemPrompt = useRef<string | null>(null);

  /**
   * Initialize the GoogleGenAI client and load the system prompt (once).
   */
  const ensureInitialized = useCallback(async () => {
    if (!ai.current) {
      ai.current = new GoogleGenAI({ apiKey: getApiKey() });
    }
    if (!systemPrompt.current) {
      try {
        systemPrompt.current = await loadPrompt('a2ui-instruction');
      } catch {
        console.warn('[A2UI Agent] Failed to load prompt, using inline fallback');
        systemPrompt.current = 'You are a UI generation agent. Given SAP tool data, produce A2UI v0.8 JSON. Output ONLY valid JSON matching the schema.';
      }
    }
  }, []);

  /**
   * Process an array of A2UI messages into a renderable surface.
   */
  const processMessages = useCallback((messages: A2UIMessage[]) => {
    let components: A2UIComponentEntry[] = [];
    let surfaceId = 'sap-data';
    let rootId = 'root';
    let dataModel = new Map<string, unknown>();
    let styles: { font?: string; primaryColor?: string } | undefined;

    for (const msg of messages) {
      if ('surfaceUpdate' in msg) {
        surfaceId = msg.surfaceUpdate.surfaceId;
        components = msg.surfaceUpdate.components;
      } else if ('dataModelUpdate' in msg) {
        dataModel = contentsToMap(msg.dataModelUpdate.contents);
      } else if ('beginRendering' in msg) {
        rootId = msg.beginRendering.root;
        styles = msg.beginRendering.styles;
      }
    }

    const surface: A2UISurface = { surfaceId, components, rootId, dataModel, styles };

    setSurfaces(prev => {
      const next = new Map(prev);
      next.set(surfaceId, surface);
      return next;
    });
  }, []);

  /**
   * Generate A2UI visual for a tool response.
   * This is the main entry point — called from useGeminiLive after tool execution.
   */
  const generateUI = useCallback(async (toolName: string, toolData: unknown) => {
    console.log(`[A2UI Agent] Generating UI for tool: ${toolName}`);
    setIsGenerating(true);
    setError(null);

    try {
      await ensureInitialized();

      const userContent = `Tool: ${toolName}\nData: ${JSON.stringify(toolData)}`;

      const response = await ai.current!.models.generateContent({
        model: UI_AGENT_MODEL,
        contents: userContent,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: A2UI_RESPONSE_SCHEMA,
          systemInstruction: systemPrompt.current!,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from UI Agent');
      }

      console.log('[A2UI Agent] Raw response:', text.substring(0, 200) + '...');

      const parsed = JSON.parse(text);
      const messages: A2UIMessage[] = parsed.messages || [];

      if (messages.length === 0) {
        throw new Error('No A2UI messages in response');
      }

      processMessages(messages);
      console.log(`[A2UI Agent] Successfully generated UI with ${messages.length} messages`);

    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error generating UI';
      console.error('[A2UI Agent] Error:', errorMsg);
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  }, [ensureInitialized, processMessages]);

  const clearSurfaces = useCallback(() => {
    setSurfaces(new Map());
    setError(null);
  }, []);

  return { generateUI, surfaces, isGenerating, error, clearSurfaces };
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/hooks/useA2UIAgent.ts
git commit -m "feat(a2ui): add useA2UIAgent hook with generateContent JSON mode"
```

---

### Task 5: Create A2UIRenderer component

**Files:**
- Create: `src/components/A2UIRenderer.tsx`
- Create: `src/components/A2UIRenderer.module.css`

**Step 1: Create the CSS file**

Create `src/components/A2UIRenderer.module.css`:

```css
.renderer {
  padding: 1rem;
}

/* Layout */
.column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  align-items: center;
}

/* Card */
.card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Text */
.h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.5rem 0; }
.h2 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.4rem 0; }
.h3 { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.3rem 0; }
.h4 { font-size: 1rem; font-weight: 500; margin: 0; }
.h5 { font-size: 0.9rem; font-weight: 500; margin: 0; }
.caption { font-size: 0.85rem; color: #666; margin: 0; }
.body { font-size: 0.95rem; margin: 0; }
.textDefault { font-size: 0.95rem; margin: 0; }

/* List */
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.listHorizontal {
  flex-direction: row;
}

/* Button */
.button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: opacity 0.2s;
}

.button:hover {
  opacity: 0.85;
}

/* TextField */
.textField {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.textFieldLabel {
  font-size: 0.85rem;
  color: #555;
}

.textFieldInput {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

/* Divider */
.divider {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 0.5rem 0;
}

.dividerVertical {
  border-top: none;
  border-left: 1px solid #e0e0e0;
  height: 100%;
  margin: 0 0.5rem;
}

/* CheckBox */
.checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Image */
.image {
  max-width: 100%;
  border-radius: 4px;
}

/* DateTimeInput */
.dateInput {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

/* Icon */
.icon {
  font-size: 1.2rem;
}
```

**Step 2: Create the renderer component**

Create `src/components/A2UIRenderer.tsx`:

```tsx
import { useCallback } from 'react';
import type { A2UISurface, A2UIComponentEntry, A2UIComponentDef, A2UIBoundValue } from '../types';
import styles from './A2UIRenderer.module.css';

interface A2UIRendererProps {
  surface: A2UISurface;
  onUserAction?: (actionName: string, context: Record<string, unknown>) => void;
}

/**
 * Resolve a BoundValue to a display string.
 * Checks the data model for path bindings, falls back to literal.
 */
function resolveBoundValue(bv: A2UIBoundValue | undefined, dataModel: Map<string, unknown>): string {
  if (!bv) return '';

  // Try path first
  if (bv.path) {
    const segments = bv.path.split('/').filter(Boolean);
    let current: unknown = dataModel;
    for (const seg of segments) {
      if (current instanceof Map) {
        current = current.get(seg);
      } else if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        current = undefined;
        break;
      }
    }
    if (current !== undefined && current !== null) {
      return String(current);
    }
  }

  // Fallback to literal
  if (bv.literalString !== undefined) return bv.literalString;
  if (bv.literalNumber !== undefined) return String(bv.literalNumber);
  if (bv.literalBoolean !== undefined) return String(bv.literalBoolean);
  if (bv.literalArray !== undefined) return bv.literalArray.join(', ');

  return '';
}

/**
 * Renders an A2UI surface — walks the component adjacency list
 * starting from the root and recursively renders React elements.
 */
export function A2UIRenderer({ surface, onUserAction }: A2UIRendererProps) {
  const componentMap = new Map<string, A2UIComponentEntry>();
  for (const entry of surface.components) {
    componentMap.set(entry.id, entry);
  }

  const primaryColor = surface.styles?.primaryColor || '#1565C0';

  const renderComponent = useCallback((id: string): React.ReactNode => {
    const entry = componentMap.get(id);
    if (!entry) return null;

    const def = entry.component;
    const weight = entry.weight;
    const flexStyle = weight !== undefined ? { flex: weight } : undefined;

    // Column
    if (def.Column) {
      const childIds = def.Column.children.explicitList || [];
      return (
        <div key={id} className={styles.column} style={flexStyle}>
          {childIds.map(cid => renderComponent(cid))}
        </div>
      );
    }

    // Row
    if (def.Row) {
      const childIds = def.Row.children.explicitList || [];
      return (
        <div key={id} className={styles.row} style={flexStyle}>
          {childIds.map(cid => renderComponent(cid))}
        </div>
      );
    }

    // Text
    if (def.Text) {
      const text = resolveBoundValue(def.Text.text, surface.dataModel);
      const hint = def.Text.usageHint || 'body';
      const className = styles[hint] || styles.textDefault;
      const Tag = hint.startsWith('h') && hint.length === 2 ? hint as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' : 'p';
      return <Tag key={id} className={className} style={flexStyle}>{text}</Tag>;
    }

    // Card
    if (def.Card) {
      return (
        <div key={id} className={styles.card} style={flexStyle}>
          {def.Card.child && renderComponent(def.Card.child)}
        </div>
      );
    }

    // List
    if (def.List) {
      const childIds = def.List.children.explicitList || [];
      const isHorizontal = def.List.direction === 'horizontal';
      const listClass = `${styles.list} ${isHorizontal ? styles.listHorizontal : ''}`;
      return (
        <ul key={id} className={listClass} style={flexStyle}>
          {childIds.map(cid => (
            <li key={cid}>{renderComponent(cid)}</li>
          ))}
        </ul>
      );
    }

    // Button
    if (def.Button) {
      const handleClick = () => {
        if (onUserAction && def.Button!.action) {
          const context: Record<string, unknown> = {};
          for (const kv of def.Button!.action.context || []) {
            context[kv.key] = resolveBoundValue(kv.value, surface.dataModel);
          }
          onUserAction(def.Button!.action.name, context);
        }
      };
      return (
        <button
          key={id}
          className={styles.button}
          style={{ backgroundColor: primaryColor, color: 'white', ...flexStyle }}
          onClick={handleClick}
        >
          {def.Button.child && renderComponent(def.Button.child)}
        </button>
      );
    }

    // TextField
    if (def.TextField) {
      const label = resolveBoundValue(def.TextField.label, surface.dataModel);
      const value = resolveBoundValue(def.TextField.text, surface.dataModel);
      return (
        <div key={id} className={styles.textField} style={flexStyle}>
          {label && <label className={styles.textFieldLabel}>{label}</label>}
          <input className={styles.textFieldInput} type="text" defaultValue={value} readOnly />
        </div>
      );
    }

    // Divider
    if (def.Divider) {
      const isVertical = def.Divider.axis === 'vertical';
      return <hr key={id} className={isVertical ? styles.dividerVertical : styles.divider} />;
    }

    // Image
    if (def.Image) {
      const url = resolveBoundValue(def.Image.url, surface.dataModel);
      return <img key={id} className={styles.image} src={url} alt="" style={flexStyle} />;
    }

    // Icon
    if (def.Icon) {
      return <span key={id} className={styles.icon} style={flexStyle}>{def.Icon.icon}</span>;
    }

    // CheckBox
    if (def.CheckBox) {
      const label = resolveBoundValue(def.CheckBox.label, surface.dataModel);
      return (
        <label key={id} className={styles.checkbox} style={flexStyle}>
          <input type="checkbox" readOnly />
          {label}
        </label>
      );
    }

    // DateTimeInput
    if (def.DateTimeInput) {
      return (
        <input
          key={id}
          className={styles.dateInput}
          type={def.DateTimeInput.enableTime ? 'datetime-local' : 'date'}
          readOnly
          style={flexStyle}
        />
      );
    }

    // Unknown component
    console.warn(`[A2UIRenderer] Unknown component type for id="${id}"`);
    return null;
  }, [componentMap, surface.dataModel, primaryColor, onUserAction]);

  return (
    <div className={styles.renderer}>
      {renderComponent(surface.rootId)}
    </div>
  );
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/components/A2UIRenderer.tsx src/components/A2UIRenderer.module.css
git commit -m "feat(a2ui): add A2UIRenderer component with full component mapping"
```

---

### Task 6: Create A2UIPanel container component

**Files:**
- Create: `src/components/A2UIPanel.tsx`
- Create: `src/components/A2UIPanel.module.css`

**Step 1: Create the CSS file**

Create `src/components/A2UIPanel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.headerTitle {
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

/* Empty state */
.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 0.9rem;
  padding: 2rem;
  text-align: center;
}

.emptyIcon {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
  opacity: 0.5;
}

/* Generating state */
.generating {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 1rem;
}

.skeleton {
  width: 80%;
  height: 1rem;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeletonWide { width: 90%; }
.skeletonMedium { width: 60%; }
.skeletonNarrow { width: 40%; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error state */
.errorState {
  padding: 1rem;
  margin: 1rem;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
  font-size: 0.85rem;
}
```

**Step 2: Create the panel component**

Create `src/components/A2UIPanel.tsx`:

```tsx
import { A2UIRenderer } from './A2UIRenderer';
import type { A2UISurface } from '../types';
import styles from './A2UIPanel.module.css';

interface A2UIPanelProps {
  surfaces: Map<string, A2UISurface>;
  isGenerating: boolean;
  error: string | null;
  onUserAction?: (actionName: string, context: Record<string, unknown>) => void;
}

export function A2UIPanel({ surfaces, isGenerating, error, onUserAction }: A2UIPanelProps) {
  const hasSurfaces = surfaces.size > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Visualización SAP</span>
      </div>

      <div className={styles.content}>
        {error && (
          <div className={styles.errorState}>
            Error generando visualización: {error}
          </div>
        )}

        {isGenerating && !hasSurfaces && (
          <div className={styles.generating}>
            <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
            <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
            <div className={`${styles.skeleton} ${styles.skeletonNarrow}`} />
            <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
            <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
          </div>
        )}

        {hasSurfaces && (
          Array.from(surfaces.values()).map(surface => (
            <A2UIRenderer
              key={surface.surfaceId}
              surface={surface}
              onUserAction={onUserAction}
            />
          ))
        )}

        {!hasSurfaces && !isGenerating && !error && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📊</div>
            <p>Las visualizaciones aparecerán aquí cuando Amy consulte datos de SAP.</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/components/A2UIPanel.tsx src/components/A2UIPanel.module.css
git commit -m "feat(a2ui): add A2UIPanel container with empty/generating/error states"
```

---

### Task 7: Update App.tsx for split-view layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/App.module.css`

**Step 1: Update App.module.css for split-view**

Replace the `.chatContainer` rule and add `.splitView` and `.a2uiContainer` in `src/styles/App.module.css`:

Find this block (lines 59-66):
```css
.chatContainer {
  flex: 1;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}
```

Replace with:
```css
.splitView {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 1rem;
  min-height: 0;
}

.chatPanel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chatContainer {
  flex: 1;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.a2uiContainer {
  flex: 1;
  min-height: 0;
}
```

Also update the `.main` rule — change `max-width: 1200px` to `max-width: 1600px` (line 43) to accommodate the wider split layout.

Add mobile responsive override inside the `@media (max-width: 768px)` block:
```css
  .splitView {
    flex-direction: column;
  }
```

**Step 2: Update App.tsx to use split-view with A2UIPanel**

Replace the entire content of `src/App.tsx`:

```tsx
import { ChatWindow } from './components/ChatWindow';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { StatusIndicator } from './components/StatusIndicator';
import { A2UIPanel } from './components/A2UIPanel';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useA2UIAgent } from './hooks/useA2UIAgent';
import styles from './styles/App.module.css';

function App() {
  const {
    state,
    messages,
    error,
    isConnected,
    startConversation,
    endConversation,
    sendMessage,
    setVoice
  } = useGeminiLive();

  const {
    surfaces,
    isGenerating,
    error: a2uiError
  } = useA2UIAgent();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI Live Sales Assistant</h1>
        <p className={styles.subtitle}>SAP Order-to-Cash Process Assistant</p>
      </header>

      <main className={styles.main}>
        <div className={styles.topPanel}>
          <StatusIndicator state={state} />
          <VoiceSelector onVoiceChange={setVoice} />
        </div>

        <div className={styles.splitView}>
          <div className={styles.chatPanel}>
            <div className={styles.chatContainer}>
              <ChatWindow messages={messages} />
            </div>

            <div className={styles.controlsContainer}>
              <Controls
                state={state}
                isConnected={isConnected}
                onStartConversation={startConversation}
                onEndConversation={endConversation}
                onSendMessage={sendMessage}
              />
            </div>
          </div>

          <div className={styles.a2uiContainer}>
            <A2UIPanel
              surfaces={surfaces}
              isGenerating={isGenerating}
              error={a2uiError}
            />
          </div>
        </div>

        {error && (
          <div className={styles.errorContainer}>
            <div className={styles.error}>
              <strong>Error ({error.type}):</strong> {error.message}
            </div>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <p>Powered by Google Gemini Live API & SAP MCP Server</p>
      </footer>
    </div>
  );
}

export default App;
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/App.tsx src/styles/App.module.css
git commit -m "feat(a2ui): split-view layout with A2UIPanel alongside chat"
```

---

### Task 8: Wire useA2UIAgent into useGeminiLive

This is the critical integration — the `generateUI()` call fires in parallel with `sendToolResponse()`.

**Files:**
- Modify: `src/hooks/useGeminiLive.ts` (around line 628)
- Modify: `src/App.tsx` (pass generateUI from hook)

**Step 1: Add generateUI parameter to useGeminiLive**

At the top of `src/hooks/useGeminiLive.ts`, add a new parameter type. Find the function signature and add an optional `onToolResponse` callback:

Find (near the top of the hook function):
```typescript
export function useGeminiLive()
```

Replace with:
```typescript
export function useGeminiLive(options?: { onToolResponse?: (toolName: string, toolData: unknown) => void })
```

**Step 2: Add the parallel generateUI call**

Find this block (around line 628):
```typescript
                await liveSession.sendToolResponse({ functionResponses });
                console.log('[Gemini Live] Tool responses sent successfully to API');
```

Replace with:
```typescript
                // Fire sendToolResponse and generateUI in parallel
                await liveSession.sendToolResponse({ functionResponses });
                console.log('[Gemini Live] Tool responses sent successfully to API');

                // Fire A2UI generation for each successful tool response (non-blocking)
                if (options?.onToolResponse) {
                  for (const fr of functionResponses) {
                    if (fr.response?.result && !String(fr.response.result).startsWith('Tool execution failed')) {
                      options.onToolResponse(fr.name, fr.response.result);
                    }
                  }
                }
```

**Step 3: Update App.tsx to pass generateUI**

In `src/App.tsx`, update the `useGeminiLive` call to pass the A2UI agent's `generateUI`:

Find:
```tsx
  const {
    surfaces,
    isGenerating,
    error: a2uiError
  } = useA2UIAgent();
```

Move `useA2UIAgent` BEFORE `useGeminiLive` and wire them:

```tsx
  const {
    generateUI,
    surfaces,
    isGenerating,
    error: a2uiError
  } = useA2UIAgent();

  const {
    state,
    messages,
    error,
    isConnected,
    startConversation,
    endConversation,
    sendMessage,
    setVoice
  } = useGeminiLive({
    onToolResponse: (toolName, toolData) => {
      generateUI(toolName, toolData);
    }
  });
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

**Step 5: Verify the app starts**

Run: `npm run dev` and check console for errors.

**Step 6: Commit**

```bash
git add src/hooks/useGeminiLive.ts src/App.tsx
git commit -m "feat(a2ui): wire generateUI into tool response flow (parallel with voice)"
```

---

### Task 9: Manual integration test

**Files:** None (test only)

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Visual verification**

Open `http://localhost:5173` in browser and verify:
1. Split-view layout: chat on left, A2UI panel on right
2. A2UI panel shows empty state: "Las visualizaciones aparecerán aquí..."
3. Start a conversation with Amy
4. Ask Amy to query SAP data (e.g., "Amy, show me recent sales orders")
5. Verify: A2UI panel shows skeleton loading, then rendered cards/tables
6. Verify: Voice continues uninterrupted while UI renders

**Step 3: Check console for errors**

Look for:
- `[A2UI Agent] Generating UI for tool: ...` — confirms trigger
- `[A2UI Agent] Successfully generated UI with X messages` — confirms rendering
- No unhandled errors

**Step 4: Build check**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

**Step 5: Final commit**

If any fixes were needed during testing, commit them:
```bash
git add -A
git commit -m "fix(a2ui): integration test fixes"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | A2UI types | — | `src/types/index.ts` |
| 2 | JSON schema | `src/utils/a2uiSchema.ts` | — |
| 3 | System prompt | `src/prompts/a2ui-instruction.md` | — |
| 4 | useA2UIAgent hook | `src/hooks/useA2UIAgent.ts` | — |
| 5 | A2UIRenderer | `src/components/A2UIRenderer.tsx`, `.module.css` | — |
| 6 | A2UIPanel | `src/components/A2UIPanel.tsx`, `.module.css` | — |
| 7 | Split-view layout | — | `src/App.tsx`, `src/styles/App.module.css` |
| 8 | Wire generateUI | — | `src/hooks/useGeminiLive.ts`, `src/App.tsx` |
| 9 | Integration test | — | — |
