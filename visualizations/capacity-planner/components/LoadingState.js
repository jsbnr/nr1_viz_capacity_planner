import React from 'react';

/**
 * Displays a progress bar while NRQL batches are being fetched.
 *
 * @param {{ progress: { done: number, total: number } }} props
 * @returns {React.ReactElement}
 */
export default function LoadingState({ progress }) {
  const { done, total } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="capacity-loading">
      <div style={{ width: '100%', maxWidth: 320 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.85em', opacity: 0.7 }}>
          <span>Loading data…</span>
          <span>{pct}%</span>
        </div>
        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: '#00b3d7',
              borderRadius: 3,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}
