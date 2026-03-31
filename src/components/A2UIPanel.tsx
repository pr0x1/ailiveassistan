import { A2UIRenderer } from './A2UIRenderer';
import type { A2UISurface } from '../types';
import styles from './A2UIPanel.module.css';

interface A2UIPanelProps {
  surfaces: Map<string, A2UISurface>;
  isGenerating: boolean;
  error: string | null;
  onUserAction?: (actionName: string, context: Record<string, unknown>) => void;
}

export function A2UIPanel({ surfaces, isGenerating, error, onUserAction }: A2UIPanelProps) {
  const hasSurfaces = surfaces.size > 0;

  return (
    <div className={styles.panel} style={{ color: '#333' }}>
      <div className={styles.header}>
        <span className={styles.headerTitle} style={{ color: '#333' }}>Visualización SAP</span>
      </div>

      <div className={styles.content} style={{ color: '#333' }}>
        {error && (
          <div className={styles.errorState}>
            Error generando visualización: {error}
          </div>
        )}

        {isGenerating && !hasSurfaces && (
          <div className={styles.generating}>
            <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
            <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
            <div className={`${styles.skeleton} ${styles.skeletonNarrow}`} />
            <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
            <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
          </div>
        )}

        {hasSurfaces && (
          Array.from(surfaces.values()).map(surface => (
            <A2UIRenderer
              key={surface.surfaceId}
              surface={surface}
              onUserAction={onUserAction}
            />
          ))
        )}

        {!hasSurfaces && !isGenerating && !error && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📊</div>
            <p>Las visualizaciones aparecerán aquí cuando Amy consulte datos de SAP.</p>
          </div>
        )}
      </div>
    </div>
  );
}
