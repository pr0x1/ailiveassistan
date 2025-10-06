import { ChatWindow } from './components/ChatWindow';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { StatusIndicator } from './components/StatusIndicator';
import { useGeminiLive } from './hooks/useGeminiLive';
import styles from './styles/App.module.css';

function App() {
  const {
    state,
    messages,
    error,
    isConnected,
    startConversation,
    endConversation,
    sendMessage,
    setVoice
  } = useGeminiLive();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI Live Sales Assistant</h1>
        <p className={styles.subtitle}>SAP Order-to-Cash Process Assistant</p>
      </header>

      <main className={styles.main}>
        <div className={styles.topPanel}>
          <StatusIndicator state={state} />
          <VoiceSelector onVoiceChange={setVoice} />
        </div>

        <div className={styles.chatContainer}>
          <ChatWindow messages={messages} />
        </div>

        <div className={styles.controlsContainer}>
          <Controls
            state={state}
            isConnected={isConnected}
            onStartConversation={startConversation}
            onEndConversation={endConversation}
            onSendMessage={sendMessage}
          />
        </div>

        {error && (
          <div className={styles.errorContainer}>
            <div className={styles.error}>
              <strong>Error ({error.type}):</strong> {error.message}
            </div>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <p>Powered by Google Gemini Live API & SAP MCP Server</p>
      </footer>
    </div>
  );
}

export default App;
