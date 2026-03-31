import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { getApiKey } from '../utils/audioConfig';
import { loadPrompt } from '../utils/promptLoader';
import type { A2UISurface, A2UIComponentEntry, A2UIMessage, A2UIDataContent, UseA2UIAgentReturn } from '../types';

/**
 * UI Agent model — can be switched to compare speed/quality.
 * Options: 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', gemini-3.1-flash-lite-preview, gemini-3-flash-preview
 */
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

    console.log('[A2UI Agent] processMessages result:', {
      surfaceId,
      rootId,
      componentCount: components.length,
      componentIds: components.map(c => c.id),
      hasDataModel: dataModel.size > 0,
      styles,
    });

    if (components.length === 0) {
      console.warn('[A2UI Agent] No components found — surface will be empty');
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
    const t0 = performance.now();
    console.log(`[A2UI Agent] generateUI CALLED for tool: ${toolName}`, {
      dataSize: JSON.stringify(toolData).length,
      timestamp: new Date().toISOString(),
    });
    setIsGenerating(true);
    setError(null);

    try {
      await ensureInitialized();
      const t1 = performance.now();
      console.log(`[A2UI Agent] ensureInitialized done (${(t1 - t0).toFixed(0)}ms)`);

      const userContent = `Tool: ${toolName}\nData: ${JSON.stringify(toolData)}`;
      console.log(`[A2UI Agent] Payload size: ${userContent.length} chars`);

      const response = await ai.current!.models.generateContent({
        model: UI_AGENT_MODEL,
        contents: userContent,
        config: {
          // JSON mode WITHOUT schema — avoids Gemini's key-flattening bug
          // that occurs when component is declared as Type.OBJECT without
          // inner properties. The system prompt + few-shot examples guide
          // the model to produce valid A2UI JSON.
          responseMimeType: 'application/json',
          systemInstruction: systemPrompt.current!,
        },
      });
      const t2 = performance.now();
      console.log(`[A2UI Agent] generateContent done (${(t2 - t1).toFixed(0)}ms, total ${(t2 - t0).toFixed(0)}ms)`);

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from UI Agent');
      }

      console.log('[A2UI Agent] Raw response:', text.substring(0, 300) + '...');
      console.log(`[A2UI Agent] Response size: ${text.length} chars`);

      const parsed = JSON.parse(text);
      const messages: A2UIMessage[] = parsed.messages || [];

      if (messages.length === 0) {
        throw new Error('No A2UI messages in response');
      }

      processMessages(messages);
      const t3 = performance.now();
      console.log(`[A2UI Agent] Successfully generated UI with ${messages.length} messages (total ${(t3 - t0).toFixed(0)}ms)`);

    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error generating UI';
      console.error('[A2UI Agent] ERROR:', errorMsg, err);
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
      console.log(`[A2UI Agent] generateUI FINISHED (${(performance.now() - t0).toFixed(0)}ms)`);
    }
  }, [ensureInitialized, processMessages]);

  const clearSurfaces = useCallback(() => {
    setSurfaces(new Map());
    setError(null);
  }, []);

  return { generateUI, surfaces, isGenerating, error, clearSurfaces };
}
