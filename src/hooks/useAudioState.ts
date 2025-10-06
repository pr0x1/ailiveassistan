import { useState, useCallback } from 'react';
import type { AppState, UseAudioStateReturn } from '../types';

/**
 * Custom hook for managing audio conversation states
 * Handles transitions between IDLE, LISTENING, PROCESSING, and SPEAKING states
 */
export const useAudioState = (initialState: AppState = 'IDLE'): UseAudioStateReturn => {
  const [currentState, setCurrentState] = useState<AppState>(initialState);

  const setState = useCallback((newState: AppState) => {
    console.log(`[AudioState] Transitioning from ${currentState} to ${newState}`);
    setCurrentState(newState);
  }, [currentState]);

  // Computed state helpers
  const isIdle = currentState === 'IDLE';
  const isListening = currentState === 'LISTENING';
  const isProcessing = currentState === 'PROCESSING';
  const isSpeaking = currentState === 'SPEAKING';

  return {
    currentState,
    setState,
    isListening,
    isProcessing,
    isSpeaking,
    isIdle
  };
};
