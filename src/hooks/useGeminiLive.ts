import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { 
  UseGeminiLiveReturn, 
  ChatMessage, 
  AppError, 
  VoiceOption
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
 * Now using AudioWorklet for proper PCM audio processing
 */
export const useGeminiLive = (): UseGeminiLiveReturn => {
  const isProcessingTool = useRef<boolean>(false);
  const [session, setSession] = useState<any | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentVoice, setCurrentVoice] = useState<VoiceOption>(DEFAULT_VOICE);

  // ✅ FIX: Add message deduplication tracking
  const lastInputTranscription = useRef<string>('');
  const lastOutputTranscription = useRef<string>('');

  // ✅ NEW: Helper function to format tool results for display
  const formatToolResult = useCallback((response: any, toolName: string): string => {
    if (!response) return 'Sin datos';
    
    if (Array.isArray(response) && response.length === 0) {
      return 'No se encontraron datos';
    }
    
    if (Array.isArray(response) && response.length > 0) {
      const firstItem = response[0];
      if (toolName.includes('SalesOrder') && firstItem.SalesOrder) {
        return `Orden #${firstItem.SalesOrder}, Monto: ${firstItem.TotalNetAmount || 'N/A'}`;
      }
      if (toolName.includes('Customer') && firstItem.Customer) {
        return `Cliente: ${firstItem.CustomerName || firstItem.Customer}`;
      }
      return `${response.length} registro(s) encontrado(s)`;
    }
    
    if (typeof response === 'object') {
      const keys = Object.keys(response);
      return `Datos: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
    }
    
    return String(response).substring(0, 100);
  }, []);

  // Use MCP client for tool execution
  const { availableTools, executeToolCall, isConnected: mcpConnected } = useMcpClient();
  
  // Use audio state management
  const { currentState, setState } = useAudioState();

  const responseQueue = useRef<any[]>([]);
  const ai = useRef<GoogleGenAI | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const isWebSocketOpen = useRef<boolean>(false);
  const isSetupComplete = useRef<boolean>(false);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);

  // ✅ FIX: Add refs for session and availableTools persistence (React closure fix)
  const sessionRef = useRef<any>(null);
  const availableToolsRef = useRef<any[]>([]);

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
   * ✅ FIX: Keep refs synchronized with state values (React closure fix)
   */
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    availableToolsRef.current = availableTools;
  }, [availableTools]);

  /**
   * Session lifecycle debugging - Monitor when session state changes
   */
  useEffect(() => {
    console.log('[DEBUG] Session state changed:', {
      hasSession: !!session,
      sessionType: session ? typeof session : 'null',
      sessionConstructor: session?.constructor?.name || 'N/A',
      isConnected: isConnected,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n')[1]?.trim() || 'unknown'
    });
  }, [session]);

  /**
   * PCM Audio encoding functions (from functional reference)
   */
  const encode = useCallback((bytes: Uint8Array): string => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  const decode = useCallback((base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }, []);

  const createBlob = useCallback((data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768; // Convert Float32 to Int16
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  }, [encode]);

  /**
   * Decode audio data for playback (from functional reference)
   */
  const decodeAudioData = useCallback(async (
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
  ): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  }, []);

  /**
   * Start audio streaming using AudioWorklet (proper PCM implementation)
   */
  const startAudioStreaming = useCallback(async (liveSession: any) => {
    if (!liveSession) {
      console.error('[Gemini Live] Cannot start audio streaming: no session provided');
      return;
    }

    try {
      console.log('[Gemini Live] Setting up AudioWorklet-based audio streaming...');
      
      // Create dual AudioContext setup (like functional reference)
      const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000
      });
      
      inputAudioContextRef.current = inputAudioContext;
      outputAudioContextRef.current = outputAudioContext;

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true
      });
      
      mediaStreamRef.current = stream;
      console.log('[Gemini Live] Audio stream obtained');

      // Load AudioWorklet processor
      console.log('[Gemini Live] Loading AudioWorklet processor...');
      await inputAudioContext.audioWorklet.addModule('./audio-processor.js');
      
      // Create AudioWorkletNode
      const audioWorkletNode = new AudioWorkletNode(inputAudioContext, 'audio-capture-processor');
      audioWorkletNodeRef.current = audioWorkletNode;

      // Handle audio data from worklet
      audioWorkletNode.port.onmessage = (event) => {
        if (event.data.type === 'audioData') {
          const inputData = event.data.audioData; // Float32Array
          const pcmBlob = createBlob(inputData);
          
          try {
            liveSession.sendRealtimeInput({ media: pcmBlob });
          } catch (sendError) {
            console.error('[Gemini Live] Failed to send PCM audio chunk:', sendError);
            
            // Check if error indicates connection is closed
            const errorMessage = (sendError as Error)?.message || String(sendError) || '';
            if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') || 
                errorMessage.includes('connection') || errorMessage.includes('WebSocket')) {
              console.warn('[Gemini Live] Connection appears closed, stopping audio worklet');
              stopAudioStreaming();
            }
          }
        }
      };

      // Connect audio pipeline
      const source = inputAudioContext.createMediaStreamSource(stream);
      source.connect(audioWorkletNode);
      
      console.log('[Gemini Live] AudioWorklet audio streaming started');

    } catch (streamError) {
      console.error('[Gemini Live] Failed to start AudioWorklet streaming:', streamError);
      setError({
        type: 'AUDIO',
        message: 'Failed to start AudioWorklet audio streaming',
        details: streamError
      });
    }
  }, [createBlob]);

  /**
   * Stop audio streaming (AudioWorklet cleanup)
   */
  const stopAudioStreaming = useCallback(() => {
    console.log('[Gemini Live] Stopping AudioWorklet audio streaming...');
    
    // Disconnect AudioWorklet
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(console.error);
      inputAudioContextRef.current = null;
    }

    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(console.error);
      outputAudioContextRef.current = null;
    }

    // Stop output sources
    if (outputSourcesRef.current) {
      outputSourcesRef.current.forEach(source => source.stop());
      outputSourcesRef.current.clear();
    }
    
    nextStartTimeRef.current = 0;

    console.log('[Gemini Live] AudioWorklet audio streaming stopped');
  }, []);


  /**
   * Start conversation with Gemini Live (updated with transcriptions)
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

    // ✅ NUEVO: Logging de timing de conexiones
    console.log('[DEBUG] Starting conversation with state:', {
      mcpConnected: mcpConnected,
      availableToolsCount: availableTools.length,
      hasAiClient: !!ai.current,
      timestamp: new Date().toISOString()
    });

    if (!mcpConnected) {
      console.error('[Gemini Live] MCP not connected at conversation start:', {
        mcpConnected: mcpConnected,
        availableTools: availableTools.length,
        timestamp: new Date().toISOString()
      });
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

      // ✅ FIX: Reset transcription deduplication tracking for new conversation
      lastInputTranscription.current = '';
      lastOutputTranscription.current = '';
      console.log('[Gemini Live] Reset transcription deduplication tracking');

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

      // Connect to real Gemini Live API with proper configuration
      console.log('[Gemini Live] Connecting to Gemini Live API...');
      
      const liveSession = await ai.current.live.connect({
       model: 'gemini-2.5-flash-native-audio-preview-09-2025',
       // model: 'gemini-live-2.5-flash-preview',
        config: {
          responseModalities: ["AUDIO" as any],
          systemInstruction: {
            parts: [{
              text: 'You are a Sales Assistant, you understand the OTC (Order-to-Cash) process in SAP, and you are capable of using the tools made available by the MCP server to execute the given requests. Do not try to invent answers if you do not have the information. When tool execution fails, explain the error clearly and suggest alternative approaches. Always maintain a helpful and professional tone in your audio responses.'
            }]
          },
          tools: geminiTools
        },
        callbacks: {
          onopen: () => {
            console.log('[DEBUG] WebSocket onopen - session state:', {
              hasSession: !!sessionRef.current,
              timestamp: new Date().toISOString()
            });
            console.log('[Gemini Live] WebSocket connection established');
            isWebSocketOpen.current = true;
            setIsConnected(true);
            setState('LISTENING');
          },
          onmessage: async (e: any) => {
            console.log('[DEBUG] WebSocket onmessage - session state:', {
              hasSession: !!sessionRef.current,
              messageType: Object.keys(e)[0],
              timestamp: new Date().toISOString()
            });
            console.log('[Gemini Live] Received message:', e);
            
            // Handle different message types from LiveServerMessage
            if (e.serverContent) {
              console.log('[Gemini Live] Server content received');
              
              // Handle input transcriptions (user speaking)
              if (e.serverContent.inputTranscription) {
                console.log('[Gemini Live] Input transcription:', e.serverContent.inputTranscription.text);
                
                // ✅ FIX: Add user voice transcription to chat messages with deduplication
                const transcriptionText = e.serverContent.inputTranscription.text;
                
                // Only add if different from last transcription (prevent duplicates)
                if (transcriptionText !== lastInputTranscription.current && transcriptionText.trim().length > 0) {
                  lastInputTranscription.current = transcriptionText;
                  
                  const userMessage: ChatMessage = {
                    id: `input-${Date.now()}`,
                    role: 'user',
                    content: transcriptionText,
                    timestamp: new Date()
                  };
                  setMessages(prev => [...prev, userMessage]);
                  console.log('[Gemini Live] Added user transcription to chat:', transcriptionText);
                } else {
                  console.log('[Gemini Live] Skipped duplicate input transcription');
                }
                
                setState('LISTENING');
              }
              
              // Handle output transcriptions (Gemini speaking)
              if (e.serverContent.outputTranscription) {
                console.log('[Gemini Live] Output transcription:', e.serverContent.outputTranscription.text);
                setState('SPEAKING');
                
                // ✅ FIX: Add assistant transcription with deduplication
                const transcriptionText = e.serverContent.outputTranscription.text;
                
                // Only add if different from last transcription (prevent duplicates)
                if (transcriptionText !== lastOutputTranscription.current && transcriptionText.trim().length > 0) {
                  lastOutputTranscription.current = transcriptionText;
                  
                  const assistantMessage: ChatMessage = {
                    id: `output-${Date.now()}`,
                    role: 'assistant',
                    content: transcriptionText,
                    timestamp: new Date()
                  };
                  setMessages(prev => [...prev, assistantMessage]);
                  console.log('[Gemini Live] Added assistant transcription to chat:', transcriptionText);
                } else {
                  console.log('[Gemini Live] Skipped duplicate output transcription');
                }
              }

              // Handle audio responses from Gemini
              if (e.serverContent.modelTurn?.parts) {
                for (const part of e.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) {
                    // Play audio response
                    if (outputAudioContextRef.current) {
                      try {
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                        const audioBuffer = await decodeAudioData(
                          decode(part.inlineData.data),
                          outputAudioContextRef.current,
                          24000,
                          1,
                        );
                        const source = outputAudioContextRef.current.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputAudioContextRef.current.destination);
                        source.addEventListener('ended', () => {
                          outputSourcesRef.current.delete(source);
                        });
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        outputSourcesRef.current.add(source);
                      } catch (audioError) {
                        console.error('[Gemini Live] Failed to play audio response:', audioError);
                      }
                    }
                  }
                }
              }
              
              // Return to listening after speaking
              if (e.serverContent.turnComplete && !isProcessingTool.current) { //Gemini modified
                console.log('[Gemini Live] Turn complete, returning to listening');
                setTimeout(() => setState('LISTENING'), 1000);
              }

              // Handle interruptions
              if (e.serverContent.interrupted) {
                console.log('[Gemini Live] Audio interrupted, stopping playback');
                outputSourcesRef.current.forEach(source => {
                  source.stop();
                  outputSourcesRef.current.delete(source);
                });
                nextStartTimeRef.current = 0;
              }
            } else if (e.toolCall) {
              // ✅ PHASE 2: Inline tool processing (matching working MRE exactly)
              console.log('[Gemini Live] Tool call received:', {
                toolCall: e.toolCall,
                sessionActive: !!liveSession,
                mcpConnected: mcpConnected,
                availableToolsCount: availableTools.length,
                timestamp: new Date().toISOString()
              });
              
              isProcessingTool.current = true;
              console.log('[Gemini Live] Tool processing STARTED, flag set to true.');
              setState('PROCESSING');

              if (!liveSession || !mcpConnected) {
                console.error('[Gemini Live] Cannot process tool calls: session or MCP not connected');
                isProcessingTool.current = false;
                setState('LISTENING');
                return;
              }

              try {
                // ✅ PHASE 2: Direct inline processing like working MRE
                const functionResponses = [];
                
                for (const functionCall of e.toolCall.functionCalls) {
                  console.log(`[Gemini Live] Processing tool call: ${functionCall.name}`);
                  
                  // ✅ NEW: Add system message for tool execution start
                  const toolStartMessage: ChatMessage = {
                    id: `tool-start-${Date.now()}`,
                    role: 'system',
                    content: `🔧 Ejecutando herramienta ${functionCall.name}...`,
                    timestamp: new Date(),
                    type: 'tool-start',
                    toolName: functionCall.name
                  };
                  setMessages(prev => [...prev, toolStartMessage]);
                  
                  try {
                    // Direct MCP call (simplified like MRE)
                    const mcpResponse = await executeToolCall(functionCall);
                    
                    // Simple response format (matching MRE pattern) - using actual MCP data
                    functionResponses.push({
                      id: functionCall.id,
                      name: functionCall.name,
                      response: {
                        result: mcpResponse.response || "Tool executed successfully",
                        timestamp: new Date().toISOString(),
                        source: functionCall.name
                      }
                    });
                    
                    console.log(`[Gemini Live] Tool ${functionCall.name} executed successfully`);
                    console.log(`[Gemini Live] MCP Response data:`, mcpResponse.response);
                    
                    // ✅ NEW: Add system message for tool execution result
                    const toolResultMessage: ChatMessage = {
                      id: `tool-result-${Date.now()}`,
                      role: 'system',
                      content: `📊 Datos obtenidos de SAP: ${formatToolResult(mcpResponse.response, functionCall.name)}`,
                      timestamp: new Date(),
                      type: 'tool-result',
                      toolName: functionCall.name,
                      toolData: mcpResponse.response
                    };
                    setMessages(prev => [...prev, toolResultMessage]);
                    
                  } catch (toolError: any) {
                    console.error(`[Gemini Live] Tool execution failed: ${functionCall.name}`, toolError);
                    
                    // ✅ NEW: Add system message for tool execution error
                    const toolErrorMessage: ChatMessage = {
                      id: `tool-error-${Date.now()}`,
                      role: 'system',
                      content: `❌ Error ejecutando ${functionCall.name}: ${toolError?.message || 'Error desconocido'}`,
                      timestamp: new Date(),
                      type: 'tool-error',
                      toolName: functionCall.name
                    };
                    setMessages(prev => [...prev, toolErrorMessage]);
                    
                    // Simple error response (matching MRE pattern)
                    functionResponses.push({
                      id: functionCall.id,
                      name: functionCall.name,
                      response: {
                        result: `Tool execution failed: ${toolError?.message || 'Unknown error'}`,
                        timestamp: new Date().toISOString(),
                        source: functionCall.name
                      }
                    });
                  }
                }

                // ✅ PHASE 2: Direct send (no complex validation like MRE)
                console.log('[Gemini Live] Sending tool responses to API:', {
                  count: functionResponses.length,
                  responses: functionResponses.map(r => ({ id: r.id, name: r.name, result: r.response })),
                });
                
                await liveSession.sendToolResponse({ functionResponses });
                console.log('[Gemini Live] Tool responses sent successfully to API');
                
              } catch (error) {
                console.error('[Gemini Live] Failed to process tool calls:', error);
                setError({
                  type: 'TOOL',
                  message: 'Failed to process tool calls',
                  details: error
                });
              }
              
              isProcessingTool.current = false;
              console.log('[Gemini Live] Tool processing FINISHED, flag set to false.');
              setState('LISTENING');
            } else if (e.setupComplete) {
              console.log('[DEBUG] Setup complete - session state:', {
                hasSession: !!session,
                sessionActive: !!session,
                isSetupComplete: isSetupComplete.current,
                timestamp: new Date().toISOString()
              });
              console.log('[Gemini Live] Setup complete');
              isSetupComplete.current = true;
            } else {
              console.log('[Gemini Live] Unknown message type:', e);
            }
          },
          onerror: (error: any) => {
            console.log('[DEBUG] WebSocket onerror - session state:', {
              hasSession: !!session,
              error: error,
              timestamp: new Date().toISOString()
            });
            console.error('[Gemini Live] WebSocket error:', error);
            isWebSocketOpen.current = false;
            setError({
              type: 'CONNECTION',
              message: 'Gemini Live connection error',
              details: error
            });
            setState('IDLE');
            stopAudioStreaming();
          },
          onclose: (event: any) => {
            console.log('[DEBUG] WebSocket onclose - session state:', {
              hasSession: !!session,
              reason: event?.reason,
              timestamp: new Date().toISOString()
            });
            console.log('[Gemini Live] WebSocket connection closed:', event?.reason || 'Unknown reason');
            isWebSocketOpen.current = false;
            setIsConnected(false);
            setState('IDLE');
            stopAudioStreaming();
          }
        }
      });

      console.log('[Gemini Live] Successfully connected to Gemini Live API');
      setSession(liveSession);

      // Start audio streaming AFTER liveSession is available (fixes Temporal Dead Zone)
      console.log('[Gemini Live] Starting AudioWorklet audio streaming...');
      await startAudioStreaming(liveSession);

    } catch (connectionError) {
      console.error('[Gemini Live] Failed to start conversation:', connectionError);
      setError({
        type: 'CONNECTION',
        message: 'Failed to connect to Gemini Live API',
        details: connectionError
      });
      setState('IDLE');
    }
  }, [ai, mcpConnected, availableTools, currentVoice, setState, startAudioStreaming, decodeAudioData, decode]);

  /**
   * End conversation
   */
  const endConversation = useCallback(() => {
    // 1. Signal audio stream end (official Gemini Live pattern)
    if (session && isWebSocketOpen.current) {
      try {
        console.log('[Gemini Live] Signaling audio stream end...');
        session.sendRealtimeInput({ audioStreamEnd: true });
      } catch (signalError) {
        console.warn('[Gemini Live] Failed to signal audio stream end:', signalError);
      }
    }
    
    // 2. Stop audio streaming
    stopAudioStreaming();
    
    // 3. Close session
    if (session) {
      try {
        session.close();
        console.log('[Gemini Live] Conversation ended');
      } catch (closeError) {
        console.warn('[Gemini Live] Error closing session:', closeError);
      }
    }
    
    // 4. Reset state
    setSession(null);
    setIsConnected(false);
    isWebSocketOpen.current = false;
    isSetupComplete.current = false;
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
      // Cleanup resources on unmount
      stopAudioStreaming();
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
