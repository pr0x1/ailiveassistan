import { useState, useEffect, useCallback, useRef } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { 
  UseMcpClientReturn, 
  McpTool, 
  AppError, 
  FunctionCall, 
  FunctionResponse 
} from '../types';
import { getMcpServerUrl } from '../utils/audioConfig';
import { 
  processMcpToolsResponse, 
  processToolExecutionResponse, 
  formatToolResponseForGemini,
  extractMcpError,
  logToolExecution
} from '../utils/mcpToolConverter';

/**
 * Custom hook for managing MCP client connection and tool execution
 */
export const useMcpClient = (): UseMcpClientReturn => {
  const [client, setClient] = useState<Client | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [availableTools, setAvailableTools] = useState<McpTool[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  
  const connectionAttempts = useRef(0);
  const isConnecting = useRef(false);
  const maxRetries = 3;

  /**
   * Connect to MCP server and discover available tools
   */
  const connect = useCallback(async () => {
    // Prevent duplicate connections (React Strict Mode protection)
    if (isConnecting.current || isConnected || client) {
      console.log('[MCP] Connection already in progress or established, skipping');
      return;
    }

    try {
      isConnecting.current = true;
      setError(null);
      connectionAttempts.current += 1;

      console.log(`[MCP] Attempting connection to SAP server (attempt ${connectionAttempts.current})`);

      // Create new client instance
      const mcpClient = new Client({
        name: 'sap-sales-assistant',
        version: '1.0.0'
      });

      // Create HTTP stream transport
      const mcpUrl = getMcpServerUrl();
      const serverParams = new StreamableHTTPClientTransport(
        new URL(mcpUrl, window.location.origin)
      );

      // Connect to server
      await mcpClient.connect(serverParams);
      
      console.log('[MCP] Successfully connected to SAP server');
      setClient(mcpClient);
      setIsConnected(true);
      connectionAttempts.current = 0;
      isConnecting.current = false;

      // Discover available tools
      try {
        console.log('[MCP] Discovering available tools...');
        const toolsResponse = await mcpClient.listTools();
        const tools = processMcpToolsResponse(toolsResponse);
        
        console.log(`[MCP] Discovered ${tools.length} tools:`, tools.map(t => t.name));
        setAvailableTools(tools);
      } catch (toolsError) {
        console.warn('[MCP] Failed to discover tools:', toolsError);
        setError({
          type: 'CONNECTION',
          message: 'Connected to server but failed to discover tools',
          details: toolsError
        });
      }

    } catch (connectionError) {
      console.error('[MCP] Connection failed:', connectionError);
      
      const errorMessage = extractMcpError(connectionError);
      setError({
        type: 'CONNECTION',
        message: `Failed to connect to MCP server: ${errorMessage}`,
        details: connectionError
      });

      setIsConnected(false);
      setClient(null);
      isConnecting.current = false;

      // Retry logic
      if (connectionAttempts.current < maxRetries) {
        console.log(`[MCP] Retrying connection in 2 seconds...`);
        setTimeout(() => connect(), 2000);
      } else {
        console.error('[MCP] Max connection attempts reached');
      }
    } finally {
      // Ensure isConnecting is always reset
      isConnecting.current = false;
    }
  }, []);

  /**
   * Disconnect from MCP server
   */
  const disconnect = useCallback(async () => {
    if (client && isConnected) {
      try {
        await client.close();
        console.log('[MCP] Disconnected from SAP server');
      } catch (disconnectError) {
        console.warn('[MCP] Error during disconnect:', disconnectError);
      }
    }
    
    setClient(null);
    setIsConnected(false);
    setAvailableTools([]);
    setError(null);
    connectionAttempts.current = 0;
  }, [client, isConnected]);

  /**
   * Execute a tool call via MCP server
   */
  const executeToolCall = useCallback(async (functionCall: FunctionCall): Promise<FunctionResponse> => {
    if (!client || !isConnected) {
      throw new Error('MCP client not connected');
    }

    const startTime = Date.now();
    
    try {
      console.log(`[MCP] Executing tool: ${functionCall.name}`, functionCall.args);

      // Call the tool on MCP server
      const response = await client.callTool({
        name: functionCall.name,
        arguments: functionCall.args
      });
      
      // Process the response
      const processedResponse = processToolExecutionResponse(response);
      
      const duration = Date.now() - startTime;
      logToolExecution(functionCall.name, functionCall.args, processedResponse, duration);

      // Format response for Gemini Live
      return formatToolResponseForGemini(
        functionCall.name, 
        functionCall.id, 
        processedResponse
      );

    } catch (toolError) {
      const duration = Date.now() - startTime;
      const errorMessage = extractMcpError(toolError);
      
      console.error(`[MCP] Tool execution failed: ${functionCall.name}`, {
        error: errorMessage,
        duration: `${duration}ms`,
        args: functionCall.args
      });

      // Return error response in expected format
      return formatToolResponseForGemini(
        functionCall.name,
        functionCall.id,
        {
          error: true,
          message: errorMessage,
          details: toolError
        }
      );
    }
  }, [client, isConnected]);

  /**
   * Auto-connect on mount
   */
  useEffect(() => {
    // Only connect if not already connected or connecting
    if (!isConnected && !client && connectionAttempts.current === 0) {
      connect();
    }
    
    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, []); // Empty dependency array to prevent multiple connections

  /**
   * Handle connection errors and reconnection
   */
  useEffect(() => {
    if (error && error.type === 'CONNECTION' && connectionAttempts.current < maxRetries) {
      const timer = setTimeout(() => {
        console.log('[MCP] Attempting automatic reconnection...');
        connect();
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [error, connect]);

  return {
    client,
    isConnected,
    availableTools,
    error,
    connect,
    disconnect,
    executeToolCall
  };
};
