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
