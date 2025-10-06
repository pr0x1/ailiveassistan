import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import type { 
  UseGeminiLiveReturn, 
  ChatMessage, 
  AppError, 
  VoiceOption,
  ToolCallMessage
} from '../types';
import { 
  getApiKey, 
  DEFAULT_VOICE
} from '../utils/audioConfig';
import { convertMcpToolsToGemini } from '../utils/mcpToolConverter';
import { useMcpClient } from './useMcpClient';
import { useAudioState } from './useAudioState';

/**
 * Custom hook for managing Gemini Live session with audio and tool integration
 */
export const useGeminiLive = (): UseGeminiLiveReturn => {
  const [session, setSession] = useState<any | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentVoice, setCurrentVoice] = useState<VoiceOption>(DEFAULT_VOICE);

  // Use MCP client for tool execution
  const { availableTools, executeToolCall, isConnected: mcpConnected } = useMcpClient();
  
  // Use audio state management
  const { currentState, setState } = useAudioState();

  const responseQueue = useRef<any[]>([]);
  const ai = useRef<GoogleGenAI | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  /**
   * Initialize Google Generative AI client
   */
  useEffect(() => {
    try {
      ai.current = new GoogleGenAI({ apiKey: getApiKey() });
    } catch (initError) {
      setError({
        type: 'API',
        message: 'Failed to initialize Gemini API client',
        details: initError
      });
    }
  }, []);

  /**
   * Start audio streaming to Gemini Live using official API
   */
  const startAudioStreaming = useCallback(async (liveSession: any) => {
    if (!liveSession) {
      console.error('[Gemini Live] Cannot start audio streaming: no session provided');
      return;
    }

    try {
      console.log('[Gemini Live] Setting up audio streaming...');
      
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      audioStreamRef.current = stream;
      console.log('[Gemini Live] Audio stream obtained');

      // Create MediaRecorder for audio chunks
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;

      // Handle audio data chunks using official API
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && liveSession) {
          console.log('[Gemini Live] Sending audio chunk:', event.data.size, 'bytes');
          try {
            // Use official API: sendRealtimeInput with media parameter
            liveSession.sendRealtimeInput({
              media: event.data  // Direct blob - API handles conversion
            });
            console.log('[Gemini Live] Audio chunk sent successfully');
          } catch (sendError) {
            console.error('[Gemini Live] Failed to send audio chunk:', sendError);
          }
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('[Gemini Live] MediaRecorder error:', event);
      };

      // Start recording in small chunks for real-time streaming
      mediaRecorder.start(100); // 100ms chunks
      console.log('[Gemini Live] Audio streaming started');

    } catch (streamError) {
      console.error('[Gemini Live] Failed to start audio streaming:', streamError);
      setError({
        type: 'AUDIO',
        message: 'Failed to start audio streaming',
        details: streamError
      });
    }
  }, []);

  /**
   * Stop audio streaming
   */
  const stopAudioStreaming = useCallback(() => {
    console.log('[Gemini Live] Stopping audio streaming...');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }

    console.log('[Gemini Live] Audio streaming stopped');
  }, []);

  /**
   * Process tool calls from Gemini Live
   */
  const processToolCalls = useCallback(async (toolCallMessage: ToolCallMessage) => {
    if (!session || !mcpConnected) {
      console.error('[Gemini Live] Cannot process tool calls: session or MCP not connected');
      return;
    }

    setState('PROCESSING');
    
    try {
      const functionResponses = [];
      
      for (const functionCall of toolCallMessage.toolCall.functionCalls) {
        console.log(`[Gemini Live] Processing tool call: ${functionCall.name}`);
        
        try {
          const response = await executeToolCall(functionCall);
          functionResponses.push(response);
        } catch (toolError: any) {
          console.error(`[Gemini Live] Tool execution failed: ${functionCall.name}`, toolError);
          
          // Create error response
          functionResponses.push({
            id: functionCall.id,
            name: functionCall.name,
            response: {
              error: true,
              message: `Tool execution failed: ${toolError?.message || 'Unknown error'}`
            }
          });
        }
      }

      // Send tool responses back to Gemini Live
      console.log('[Gemini Live] Sending tool responses...');
      await session.sendToolResponse({ functionResponses });
      
    } catch (error) {
      console.error('[Gemini Live] Failed to process tool calls:', error);
      setError({
        type: 'TOOL',
        message: 'Failed to process tool calls',
        details: error
      });
    }
  }, [session, mcpConnected, executeToolCall, setState]);

  // Note: processServerContent removed as it's not needed for enhanced mock implementation

  /**
   * Start conversation with Gemini Live
   */
  const startConversation = useCallback(async () => {
    if (!ai.current) {
      setError({
        type: 'API',
        message: 'Gemini AI client not initialized',
        details: null
      });
      return;
    }

    if (!mcpConnected) {
      setError({
        type: 'CONNECTION',
        message: 'MCP server not connected. Please wait for connection.',
        details: null
      });
      return;
    }

    try {
      setError(null);
      setState('IDLE');

      console.log('[Gemini Live] Starting conversation...');

      // Convert MCP tools to Gemini format
      const geminiTools = convertMcpToolsToGemini(availableTools);
      
      console.log(`[Gemini Live] Configured with ${geminiTools.length} tools`);

      // Request microphone permissions
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[Gemini Live] Microphone access granted');
      } catch (micError) {
        setError({
          type: 'AUDIO',
          message: 'Microphone access denied. Please allow microphone access to use voice features.',
          details: micError
        });
        return;
      }

      // Connect to real Gemini Live API with WebSocket audio streaming
      console.log('[Gemini Live] Connecting to Gemini Live API...');
      
      // Store session reference to avoid context issues
      let sessionRef: any = null;
      
      const liveSession = await ai.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{
              text: 'You are a Sales Assistant, you understand the OTC (Order-to-Cash) process in SAP, and you are capable of using the tools made available by the MCP server to execute the given requests. Do not try to invent answers if you do not have the information. When tool execution fails, explain the error clearly and suggest alternative approaches. Always maintain a helpful and professional tone in your audio responses.'
            }]
          },
          tools: geminiTools.length > 0 ? geminiTools : undefined
        },
        callbacks: {
          onopen: () => {
            console.log('[Gemini Live] WebSocket connection established');
            console.log('[Gemini Live] Starting audio streaming...');
            setIsConnected(true);
            setState('LISTENING');
            
            // Start audio streaming using stored session reference
            startAudioStreaming(sessionRef);
          },
          onmessage: (e: any) => {
            console.log('[Gemini Live] Received message:', e);
            
            // Handle different message types from LiveServerMessage
            if (e.serverContent) {
              console.log('[Gemini Live] Server content received');
              setState('SPEAKING');
              
              // Process text content if available
              if (e.serverContent.modelTurn?.parts) {
                for (const part of e.serverContent.modelTurn.parts) {
                  if (part.text) {
                    console.log('[Gemini Live] Text response:', part.text);
                    const assistantMessage: ChatMessage = {
                      id: Date.now().toString(),
                      role: 'assistant',
                      content: part.text,
                      timestamp: new Date()
                    };
                    setMessages(prev => [...prev, assistantMessage]);
                  }
                }
              }
              
              // Return to listening after speaking
              if (e.serverContent.turnComplete) {
                console.log('[Gemini Live] Turn complete, returning to listening');
                setTimeout(() => setState('LISTENING'), 1000);
              }
            } else if (e.toolCall) {
              console.log('[Gemini Live] Tool call received');
              processToolCalls(e);
            } else if (e.setupComplete) {
              console.log('[Gemini Live] Setup complete');
            } else {
              console.log('[Gemini Live] Unknown message type:', e);
            }
          },
          onerror: (error: any) => {
            console.error('[Gemini Live] WebSocket error:', error);
            setError({
              type: 'CONNECTION',
              message: 'Gemini Live connection error',
              details: error
            });
            setState('IDLE');
          },
          onclose: (_event: any) => {
            console.log('[Gemini Live] WebSocket connection closed');
            setIsConnected(false);
            setState('IDLE');
          }
        }
      });

      console.log('[Gemini Live] Successfully connected to Gemini Live API');
      // Store session reference for audio streaming
      sessionRef = liveSession;
      setSession(liveSession);

    } catch (connectionError) {
      console.error('[Gemini Live] Failed to start conversation:', connectionError);
      setError({
        type: 'CONNECTION',
        message: 'Failed to connect to Gemini Live API',
        details: connectionError
      });
      setState('IDLE');
    }
  }, [ai, mcpConnected, availableTools, currentVoice, setState, isConnected, processToolCalls, startAudioStreaming]);

  // Note: processMessageLoop removed as it's not needed for current implementation

  /**
   * End conversation
   */
  const endConversation = useCallback(() => {
    // Stop audio streaming first
    stopAudioStreaming();
    
    if (session) {
      try {
        session.close();
        console.log('[Gemini Live] Conversation ended');
      } catch (closeError) {
        console.warn('[Gemini Live] Error closing session:', closeError);
      }
    }
    
    setSession(null);
    setIsConnected(false);
    setState('IDLE');
    responseQueue.current = [];
  }, [session, setState, stopAudioStreaming]);

  /**
   * Send a text message (for testing purposes)
   */
  const sendMessage = useCallback((message: string) => {
    if (!session || !isConnected) {
      console.warn('[Gemini Live] Cannot send message: session not connected');
      return;
    }

    try {
      // Add user message to chat
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: message,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, userMessage]);

      // Send to Gemini Live
      session.sendClientContent({
        turns: [{
          role: 'user',
          parts: [{ text: message }]
        }],
        turnComplete: true
      });

      setState('PROCESSING');
    } catch (sendError) {
      console.error('[Gemini Live] Failed to send message:', sendError);
      setError({
        type: 'API',
        message: 'Failed to send message',
        details: sendError
      });
    }
  }, [session, isConnected, setState]);

  /**
   * Change voice
   */
  const setVoice = useCallback((voice: VoiceOption) => {
    setCurrentVoice(voice);
    console.log(`[Gemini Live] Voice changed to: ${voice}`);
    
    // If session is active, restart with new voice
    if (isConnected) {
      endConversation();
      setTimeout(() => startConversation(), 1000);
    }
  }, [isConnected, endConversation, startConversation]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // Use a ref to avoid dependency issues
      if (session) {
        try {
          session.close();
          console.log('[Gemini Live] Session closed on unmount');
        } catch (closeError) {
          console.warn('[Gemini Live] Error closing session on unmount:', closeError);
        }
      }
    };
  }, []); // Empty dependency array to only run on unmount

  return {
    session,
    state: currentState,
    messages,
    error,
    isConnected,
    startConversation,
    endConversation,
    sendMessage,
    setVoice
  };
};
