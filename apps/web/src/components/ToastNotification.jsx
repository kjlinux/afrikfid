import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Container ───────────────────────────────────────────────────────────────

const TYPE_STYLES = {
  success: { bg: 'var(--af-success)', icon: '✓' },
  error:   { bg: 'var(--af-danger)',  icon: '✕' },
  warning: { bg: 'var(--af-warning)', icon: '!' },
  info:    { bg: 'var(--af-info)',    icon: 'i' },
};

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const { bg, icon } = TYPE_STYLES[toast.type] || TYPE_STYLES.info;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      background: bg, color: '#fff',
      padding: '12px 16px', borderRadius: 'var(--af-radius)',
      boxShadow: 'var(--af-shadow-elevated)',
      fontSize: 14, lineHeight: 1.4,
      animation: 'af-slide-in 0.2s ease-out',
    }}>
      <span style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
        background: 'rgba(255,255,255,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
      }}>{icon}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1, opacity: 0.7 }}
        aria-label="Fermer"
      >×</button>
    </div>
  );
}
