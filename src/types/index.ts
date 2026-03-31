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
  Button?: { child: string; action: A2UIAction; primary?: boolean };
  TextField?: { label: A2UIBoundValue; text: A2UIBoundValue; textFieldType?: string; validationRegexp?: string };
  Image?: { url: A2UIBoundValue; fit?: string; usageHint?: string };
  Icon?: { name: A2UIBoundValue };
  Divider?: { axis?: 'horizontal' | 'vertical' };
  CheckBox?: { label: A2UIBoundValue; value: A2UIBoundValue };
  DateTimeInput?: { value: A2UIBoundValue; enableDate?: boolean; enableTime?: boolean };
  Tabs?: { tabItems: Array<{ title: A2UIBoundValue; child: string }> };
  Modal?: { entryPointChild: string; contentChild: string };
  MultipleChoice?: { selections: A2UIBoundValue; options: Array<{ label: A2UIBoundValue; value: string }>; maxAllowedSelections?: number };
  Slider?: { value: A2UIBoundValue; minValue?: number; maxValue?: number };
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
