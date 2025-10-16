// Application state types
export type AppState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

// Voice options for Gemini Live
export type VoiceOption = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Leda' | 'Orus' | 'Aoede';

// Chat message types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  type?: 'voice' | 'tool-start' | 'tool-result' | 'tool-error' | 'status';
  toolName?: string;
  toolData?: any;
}

// MCP Tool types
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpToolResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

// Gemini Live types
export interface GeminiLiveConfig {
  model: string;
  responseModalities: string[];
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: any;
    }>;
  }>;
  systemInstruction?: string;
  voiceName?: VoiceOption;
}

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface FunctionResponse {
  id: string;
  name: string;  // ✅ RESTORED: Required field per official API specification
  response: any;
}

export interface ToolCallMessage {
  toolCall: {
    functionCalls: FunctionCall[];
  };
}

export interface ServerContentMessage {
  serverContent: {
    modelTurn?: {
      parts: Array<{
        text?: string;
      }>;
    };
    turnComplete?: boolean;
  };
}

// Audio configuration
export interface AudioConfig {
  voiceName: VoiceOption;
  enableVAD: boolean;
  sampleRate?: number;
}

// Error types
export interface AppError {
  type: 'CONNECTION' | 'AUDIO' | 'TOOL' | 'API';
  message: string;
  details?: any;
}

// Hook return types
export interface UseMcpClientReturn {
  client: any | null;
  isConnected: boolean;
  availableTools: McpTool[];
  error: AppError | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  executeToolCall: (functionCall: FunctionCall) => Promise<FunctionResponse>;
}

export interface UseGeminiLiveReturn {
  session: any | null;
  state: AppState;
  messages: ChatMessage[];
  error: AppError | null;
  isConnected: boolean;
  startConversation: () => Promise<void>;
  endConversation: () => void;
  sendMessage: (message: string) => void;
  setVoice: (voice: VoiceOption) => void;
}

export interface UseAudioStateReturn {
  currentState: AppState;
  setState: (state: AppState) => void;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  isIdle: boolean;
}
