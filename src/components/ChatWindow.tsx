import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import styles from '../styles/ChatWindow.module.css';

interface ChatWindowProps {
  messages: ChatMessage[];
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatTime = (timestamp: Date) => {
    return timestamp.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className={styles.chatWindow}>
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎤</div>
            <h3>Ready to assist with your SAP sales orders</h3>
            <p>Start a conversation to begin using the SAP Order-to-Cash tools</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.message} ${
                message.role === 'user' 
                  ? styles.userMessage 
                  : message.role === 'system' 
                    ? styles.systemMessage 
                    : styles.assistantMessage
              }`}
            >
              <div className={styles.messageContent}>
                <div className={styles.messageText}>
                  {message.content}
                  {/* Show additional tool data for system messages */}
                  {message.role === 'system' && message.type === 'tool-result' && message.toolData && (
                    <div className={styles.toolData}>
                      <details className={styles.toolDetails}>
                        <summary>Ver datos completos</summary>
                        <pre className={styles.toolDataContent}>
                          {JSON.stringify(message.toolData, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
                <div className={styles.messageTime}>
                  {formatTime(message.timestamp)}
                  {message.role === 'system' && message.toolName && (
                    <span className={styles.toolName}> • {message.toolName}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
