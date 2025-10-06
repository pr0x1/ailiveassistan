import type { McpTool } from '../types';
import { Type } from '@google/genai';

/**
 * Converts MCP tools to Gemini Live function declarations format
 */
export const convertMcpToolsToGemini = (mcpTools: McpTool[]) => {
  if (mcpTools.length === 0) {
    return [];
  }

  // Return a single tool object with all function declarations
  return [{
    functionDeclarations: mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || []
      }
    }))
  }];
};

/**
 * Converts a single MCP tool to Gemini format
 */
export const convertSingleMcpTool = (tool: McpTool) => {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  };
};

/**
 * Validates MCP tool structure
 */
export const validateMcpTool = (tool: any): tool is McpTool => {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    typeof tool.name === 'string' &&
    typeof tool.description === 'string' &&
    typeof tool.inputSchema === 'object' &&
    tool.inputSchema !== null &&
    typeof tool.inputSchema.type === 'string'
  );
};

/**
 * Filters and validates MCP tools from server response
 */
export const processMcpToolsResponse = (response: any): McpTool[] => {
  if (!response || !Array.isArray(response.tools)) {
    console.warn('Invalid MCP tools response format');
    return [];
  }

  return response.tools
    .filter(validateMcpTool)
    .map((tool: McpTool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
};

/**
 * Creates a tool execution request for MCP server
 */
export const createToolExecutionRequest = (toolName: string, args: Record<string, any>) => {
  return {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    }
  };
};

/**
 * Processes tool execution response from MCP server
 */
export const processToolExecutionResponse = (response: any) => {
  if (!response) {
    throw new Error('Empty response from MCP server');
  }

  if (response.error) {
    throw new Error(`MCP tool execution error: ${response.error.message || 'Unknown error'}`);
  }

  // Handle different response formats
  if (response.content) {
    return response.content;
  }

  if (response.result) {
    return response.result;
  }

  return response;
};

/**
 * Formats tool response for Gemini Live
 */
export const formatToolResponseForGemini = (toolName: string, toolId: string, response: any) => {
  return {
    id: toolId,
    name: toolName,
    response: response
  };
};

/**
 * Extracts error message from MCP response
 */
export const extractMcpError = (error: any): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (error?.message) {
    return error.message;
  }

  if (error?.error?.message) {
    return error.error.message;
  }

  return 'Unknown MCP server error';
};

/**
 * Logs tool execution for debugging
 */
export const logToolExecution = (toolName: string, args: any, response: any, duration: number) => {
  console.log(`[MCP Tool] ${toolName}`, {
    arguments: args,
    response: response,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString()
  });
};
