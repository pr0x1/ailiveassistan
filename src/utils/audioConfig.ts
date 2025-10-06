import type { VoiceOption, AudioConfig } from '../types';

// Voice options available in Gemini Live
export const VOICE_OPTIONS: VoiceOption[] = [
  'Zephyr',
  'Puck', 
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede'
];

// Default voice (as specified in requirements)
export const DEFAULT_VOICE: VoiceOption = 'Aoede';

// Gemini Live model configuration
export const GEMINI_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

// System instruction for SAP Sales Assistant
export const SYSTEM_INSTRUCTION = `You are a Sales Assistant, you understand the OTC (Order-to-Cash) process in SAP, and you are capable of using the tools made available by the MCP server to execute the given requests. Do not try to invent answers if you do not have the information. When tool execution fails, explain the error clearly and suggest alternative approaches. Always maintain a helpful and professional tone in your audio responses.`;

// Default audio configuration
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  voiceName: DEFAULT_VOICE,
  enableVAD: true,
  sampleRate: 16000
};

// Audio response modalities
export const RESPONSE_MODALITIES = ['AUDIO'];

// Voice display names for UI
export const VOICE_DISPLAY_NAMES: Record<VoiceOption, string> = {
  'Zephyr': 'Zephyr',
  'Puck': 'Puck',
  'Charon': 'Charon', 
  'Kore': 'Kore',
  'Fenrir': 'Fenrir',
  'Leda': 'Leda',
  'Orus': 'Orus',
  'Aoede': 'Aoede (Default)'
};

// State display names for UI
export const STATE_DISPLAY_NAMES = {
  IDLE: 'Ready',
  LISTENING: 'Listening...',
  PROCESSING: 'Processing...',
  SPEAKING: 'Speaking...'
};

// State colors for visual indicators
export const STATE_COLORS = {
  IDLE: '#6b7280',      // Gray
  LISTENING: '#3b82f6',  // Blue
  PROCESSING: '#f59e0b', // Amber
  SPEAKING: '#10b981'    // Green
};

// Environment variables
export const getApiKey = (): string => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY environment variable is not set');
  }
  return apiKey;
};

export const getMcpServerUrl = (): string => {
  // Use proxy endpoint in development, direct URL in production
  if (import.meta.env.DEV) {
    return '/api/mcp';
  }
  
  const url = import.meta.env.VITE_MCP_SERVER_URL;
  if (!url) {
    throw new Error('VITE_MCP_SERVER_URL environment variable is not set');
  }
  return url;
};

// Utility functions
export const isValidVoice = (voice: string): voice is VoiceOption => {
  return VOICE_OPTIONS.includes(voice as VoiceOption);
};

export const getVoiceDisplayName = (voice: VoiceOption): string => {
  return VOICE_DISPLAY_NAMES[voice] || voice;
};
