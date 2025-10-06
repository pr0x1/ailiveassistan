import React, { useState } from 'react';
import type { VoiceOption } from '../types';
import { VOICE_OPTIONS, DEFAULT_VOICE, getVoiceDisplayName } from '../utils/audioConfig';
import styles from '../styles/VoiceSelector.module.css';

interface VoiceSelectorProps {
  onVoiceChange: (voice: VoiceOption) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({ onVoiceChange }) => {
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>(DEFAULT_VOICE);

  const handleVoiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const voice = event.target.value as VoiceOption;
    setSelectedVoice(voice);
    onVoiceChange(voice);
  };

  return (
    <div className={styles.voiceSelector}>
      <label htmlFor="voice-select" className={styles.label}>
        Voice:
      </label>
      <select
        id="voice-select"
        value={selectedVoice}
        onChange={handleVoiceChange}
        className={styles.select}
      >
        {VOICE_OPTIONS.map((voice) => (
          <option key={voice} value={voice}>
            {getVoiceDisplayName(voice)}
          </option>
        ))}
      </select>
    </div>
  );
};
