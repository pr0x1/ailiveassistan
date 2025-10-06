import React, { useState } from 'react';
import type { AppState } from '../types';
import styles from '../styles/Controls.module.css';

interface ControlsProps {
  state: AppState;
  isConnected: boolean;
  onStartConversation: () => void;
  onEndConversation: () => void;
  onSendMessage: (message: string) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  state,
  isConnected,
  onStartConversation,
  onEndConversation,
  onSendMessage
}) => {
  const [testMessage, setTestMessage] = useState('');

  const handleStartClick = () => {
    onStartConversation();
  };

  const handleEndClick = () => {
    onEndConversation();
  };

  const handleSendTestMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (testMessage.trim()) {
      onSendMessage(testMessage.trim());
      setTestMessage('');
    }
  };

  const isIdle = state === 'IDLE';
  const canStart = isIdle && !isConnected;
  const canEnd = isConnected;
  const canSendMessage = isConnected && testMessage.trim().length > 0;

  return (
    <div className={styles.controls}>
      <div className={styles.mainControls}>
        <button
          onClick={handleStartClick}
          disabled={!canStart}
          className={`${styles.button} ${styles.startButton}`}
        >
          {state === 'IDLE' && !isConnected ? 'Start Conversation' : 'Starting...'}
        </button>

        <button
          onClick={handleEndClick}
          disabled={!canEnd}
          className={`${styles.button} ${styles.endButton}`}
        >
          End Conversation
        </button>
      </div>

      {/* Test message input for development */}
      <div className={styles.testControls}>
        <form onSubmit={handleSendTestMessage} className={styles.testForm}>
          <input
            type="text"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Type a test message (for development)..."
            className={styles.testInput}
            disabled={!isConnected}
          />
          <button
            type="submit"
            disabled={!canSendMessage}
            className={`${styles.button} ${styles.sendButton}`}
          >
            Send
          </button>
        </form>
      </div>

      <div className={styles.instructions}>
        {!isConnected && (
          <p>Click "Start Conversation" to begin audio interaction with the SAP assistant</p>
        )}
        {isConnected && state === 'LISTENING' && (
          <p>🎤 Listening... Speak naturally about your SAP sales orders</p>
        )}
        {isConnected && state === 'PROCESSING' && (
          <p>⏳ Processing your request and executing SAP tools...</p>
        )}
        {isConnected && state === 'SPEAKING' && (
          <p>🔊 Assistant is responding...</p>
        )}
      </div>
    </div>
  );
};
