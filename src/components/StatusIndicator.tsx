import React from 'react';
import type { AppState } from '../types';
import { STATE_DISPLAY_NAMES, STATE_COLORS } from '../utils/audioConfig';
import styles from '../styles/StatusIndicator.module.css';

interface StatusIndicatorProps {
  state: AppState;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ state }) => {
  const displayName = STATE_DISPLAY_NAMES[state];
  const color = STATE_COLORS[state];

  return (
    <div className={styles.statusIndicator}>
      <div className={styles.statusLabel}>Status:</div>
      <div 
        className={styles.statusValue}
        style={{ color }}
      >
        <div 
          className={styles.statusDot}
          style={{ backgroundColor: color }}
        />
        {displayName}
      </div>
    </div>
  );
};
