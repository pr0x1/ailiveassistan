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
 * Now using AudioWorklet for proper PCM audio processing
 */
export const useGeminiLive = (): UseGeminiLiveReturn => {
  const isProcessingTool = useRef<boolean>(false);
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
   * ✅ FIX: Process tool calls using direct session parameter (Race condition fix)
   */
  const processToolCalls = useCallback(async (
    toolCallMessage: ToolCallMessage,
    currentSession: any  // ← Add session parameter to eliminate race condition
  ) => {
    // ✅ FIX: Use session parameter instead of ref to avoid race condition
    const currentAvailableTools = availableToolsRef.current;

    console.log('[DEBUG] Tool call validation:', {
      hasSession: !!currentSession,
      mcpConnected: mcpConnected,
      availableToolsCount: currentAvailableTools.length,
      toolCallName: toolCallMessage.toolCall.functionCalls[0]?.name,
      toolCallId: toolCallMessage.toolCall.functionCalls[0]?.id,
      timestamp: new Date().toISOString()
    });

    if (!currentSession || !mcpConnected) {
      console.error('[Gemini Live] Cannot process tool calls: session or MCP not connected', {
        session: !!currentSession,
        mcpConnected: mcpConnected,
        availableTools: currentAvailableTools.length,
        toolCall: toolCallMessage.toolCall.functionCalls[0]?.name,
        toolCallArgs: toolCallMessage.toolCall.functionCalls[0]?.args,
        timestamp: new Date().toISOString()
      });
      return;
    }

    console.log('[Gemini Live] Tool call validation passed, proceeding with execution');
    setState('PROCESSING');
    
    try {
      const functionResponses = [];
      
      for (const functionCall of toolCallMessage.toolCall.functionCalls) {
        console.log(`[Gemini Live] Processing tool call: ${functionCall.name}`);
        
        try {
          const response = await executeToolCall(functionCall);
          //console.log('[DEBUG] STRINGIFIED original response.response:', JSON.stringify(response.response, null, 2));
          // ✅ FIX: Validate response structure for official Gemini Live API format (with required name field)
          if (response && response.id && response.name && response.response !== undefined) {
            //functionResponses.push(response);
              const testPayload = {
                 status: "SUCCESS",
                 message: `Test response for tool ${response.name}.`,
                 timestamp: new Date().toISOString()
          };
          console.log('[DEBUG] Sending HARDCODED test payload:', testPayload);
            functionResponses.push({
                  id: response.id,
                  name: response.name,
                 // response: response.response
                 response: testPayload
          });  
            console.log(`[Gemini Live] Sanitized and valid response for ${functionCall.name} was ADDED.`) 
            console.log(`[Gemini Live] Valid response for ${functionCall.name}:`, {
              id: response.id,
              name: response.name,
              hasResponse: !!response.response,
              responseType: typeof response.response
            });
          } else {
            console.warn(`[Gemini Live] Invalid response structure for ${functionCall.name}:`, response);
            
            // Create fallback response in official API format with required name field
            functionResponses.push({
              id: functionCall.id,
              name: functionCall.name,  // ✅ RESTORED: Required field per official API specification
              response: {
                error: `Invalid response structure from tool ${functionCall.name}`,
                details: 'Tool response validation failed'
              }
            });
          }
        } catch (toolError: any) {
          console.error(`[Gemini Live] Tool execution failed: ${functionCall.name}`, toolError);
          
          // ✅ FIX: Create proper error response structure in official API format with required name field
          functionResponses.push({
            id: functionCall.id,
            name: functionCall.name,  // ✅ RESTORED: Required field per official API specification
            response: {
              error: `Tool execution failed: ${toolError?.message || 'Unknown error'}`,
              details: toolError?.message || 'Unknown error'
            }
          });
        }
      }

      // ✅ FIX: Enhanced validation and logging for functionResponses
      console.log('[Gemini Live] Pre-send validation:', {
        functionResponsesLength: functionResponses.length,
        functionResponsesContent: functionResponses,
        allResponsesValid: functionResponses.every(r => r && r.id && r.response !== undefined)
      });

      // ✅ FIX: Never send empty array - create fallback response if needed
      if (functionResponses.length === 0) {
        console.error('[Gemini Live] No valid function responses generated, creating fallback response');
        
        // Create a fallback response for the first function call
        const firstFunctionCall = toolCallMessage.toolCall.functionCalls[0];
        if (firstFunctionCall) {
          functionResponses.push({
            id: firstFunctionCall.id,
            name: firstFunctionCall.name,  // ✅ RESTORED: Required field per official API specification
            response: {
              error: 'Tool execution failed - no valid responses generated',
              details: 'All tool executions failed or returned invalid responses'
            }
          });
        } else {
          console.error('[Gemini Live] Cannot create fallback response - no function calls found');
          return;
        }
      }

      // ✅ FIX: Final validation before sending
      const validResponses = functionResponses.filter(r => 
        r && 
        typeof r.id === 'string' && 
        r.id.length > 0 && 
        r.response !== undefined && 
        r.response !== null
      );

      // ✅ CRITICAL FIX: Ensure functionResponses is NEVER zero or null
      if (validResponses.length === 0) {
        console.error('[Gemini Live] All responses failed final validation, creating emergency fallback');
        
        // ✅ GUARANTEE: Always send at least 1 valid response to prevent "functionResponses is required" error
        const emergencyResponse = {
          id: toolCallMessage.toolCall.functionCalls[0]?.id || `fallback-${Date.now()}`,
          name: toolCallMessage.toolCall.functionCalls[0]?.name || 'unknown_tool',
          response: {
            result: "Tool execution completed with validation errors. Please check the tool configuration and try again."
          }
        };
        
        validResponses.push(emergencyResponse);
        console.log('[Gemini Live] Emergency fallback response created:', emergencyResponse);
      }

      console.log('[Gemini Live] Sending tool responses to API...', {
        originalCount: functionResponses.length,
        validCount: validResponses.length,
        responses: validResponses.map(r => ({ 
          id: r.id, 
          hasResponse: !!r.response,
          responseType: typeof r.response,
          responseKeys: r.response ? Object.keys(r.response) : []
        }))
      });
      validResponses.forEach(r => {
        console.log(`[Gemini Live] Tool response sent to API:`, r.id,r.name,r.response);
      });
      // ✅ GUARANTEED: validResponses.length is always >= 1
      await currentSession.sendToolResponse({ functionResponses: validResponses });
      
      console.log('[Gemini Live] Tool responses sent successfully to API');
      
    } catch (error) {
      console.error('[Gemini Live] Failed to process tool calls:', error);
      setError({
        type: 'TOOL',
        message: 'Failed to process tool calls',
        details: error
      });
    }
  }, [mcpConnected, executeToolCall, setState]); // ✅ FIX: Removed session and availableTools from dependencies

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
                // TODO: Update UI with real-time user transcription
                setState('LISTENING');
              }
              
              // Handle output transcriptions (Gemini speaking)
              if (e.serverContent.outputTranscription) {
                console.log('[Gemini Live] Output transcription:', e.serverContent.outputTranscription.text);
                setState('SPEAKING');
                
                // Add transcription to messages
                const assistantMessage: ChatMessage = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: e.serverContent.outputTranscription.text,
                  timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
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
              // ✅ NUEVO: Logging detallado cuando llega tool call
              console.log('[Gemini Live] Tool call received:', {
                toolCall: e.toolCall,
                sessionActive: !!liveSession,
                mcpConnected: mcpConnected,
                availableToolsCount: availableTools.length,
                timestamp: new Date().toISOString()
              });
              isProcessingTool.current = true;//Gemini modified
               console.log('[Gemini Live] Tool processing STARTED, flag set to true.');//Gemini modified
              // ✅ CRITICAL FIX: Await async processToolCalls (Official Gemini Live pattern)

              //await processToolCalls(e, liveSession);
              if (sessionRef.current) {
                 await processToolCalls(e, sessionRef.current);
              } else {
                console.error('[Gemini Live] CRITICAL: sessionRef is null when tool call was received. Aborting.');
              }
              
                 isProcessingTool.current = false; //Gemini modified
                console.log('[Gemini Live] Tool processing FINISHED, flag set to false.');//Gemini modified
                // Como el 'turnComplete' pudo haber llegado antes, volvemos a escuchar aquí.
                 setState('LISTENING'); //Gemini modified
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
  }, [ai, mcpConnected, availableTools, currentVoice, setState, processToolCalls, startAudioStreaming, decodeAudioData, decode]);

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
