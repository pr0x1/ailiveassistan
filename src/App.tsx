import { ChatWindow } from './components/ChatWindow';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { StatusIndicator } from './components/StatusIndicator';
import { A2UIPanel } from './components/A2UIPanel';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useA2UIAgent } from './hooks/useA2UIAgent';
import styles from './styles/App.module.css';

function App() {
  const {
    generateUI,
    surfaces,
    isGenerating,
    error: a2uiError
  } = useA2UIAgent();

  const {
    state,
    messages,
    error,
    isConnected,
    startConversation,
    endConversation,
    sendMessage,
    setVoice
  } = useGeminiLive({
    onToolResponse: (toolName, toolData) => {
      generateUI(toolName, toolData);
    }
  });

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

        <div className={styles.splitView}>
          <div className={styles.chatPanel}>
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
          </div>

          <div className={styles.a2uiContainer}>
            <A2UIPanel
              surfaces={surfaces}
              isGenerating={isGenerating}
              error={a2uiError}
            />
          </div>
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
