import { useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4001';

/**
 * Hook pour se connecter à un endpoint SSE Afrik'Fid.
 *
 * @param {string} endpoint  — ex: 'admin', 'merchant', 'transaction/uuid'
 * @param {string|null} token — JWT access token (passé en query param ?token=)
 * @param {Object<string, function>} handlers — { 'payment.success': fn, ... }
 * @param {boolean} [enabled=true] — activer/désactiver la connexion
 */
export function useSSE(endpoint, token, handlers, enabled = true) {
  const esRef = useRef(null);
  const handlersRef = useRef(handlers);

  // Mettre à jour les handlers sans reconnecter
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const connect = useCallback(() => {
    if (!token || !enabled) return;

    const url = `${API_BASE}/api/v1/sse/${endpoint}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    // Événement générique d'erreur (reconnexion automatique par EventSource)
    es.onerror = () => {
      // EventSource re-tente automatiquement — pas d'action nécessaire
    };

    // Enregistrer les listeners pour chaque événement
    const eventTypes = [
      'payment.success',
      'payment.failed',
      'payment.expired',
      'webhook.failed',
      'loyalty.status_changed',
      'transaction.status',
      'connected',
    ];

    for (const evt of eventTypes) {
      es.addEventListener(evt, (e) => {
        try {
          const data = JSON.parse(e.data);
          const handler = handlersRef.current?.[evt];
          if (handler) handler(data, evt);
          const wildcardHandler = handlersRef.current?.['*'];
          if (wildcardHandler) wildcardHandler(data, evt);
        } catch { /* JSON parse error */ }
      });
    }

    return es;
  }, [endpoint, token, enabled]);

  useEffect(() => {
    const es = connect();
    return () => {
      if (es) es.close();
      if (esRef.current) esRef.current.close();
    };
  }, [connect]);
}

/**
 * Variante pour les transactions — ne nécessite pas de token (txId est non-devinable)
 */
export function useTransactionSSE(transactionId, onStatus) {
  useEffect(() => {
    if (!transactionId) return;

    const url = `${API_BASE}/api/v1/sse/transaction/${transactionId}`;
    const es = new EventSource(url);

    es.addEventListener('transaction.status', (e) => {
      try {
        const data = JSON.parse(e.data);
        onStatus(data);
      } catch { /* ignore */ }
    });

    es.onerror = () => { /* reconnexion auto */ };

    return () => es.close();
  }, [transactionId]); // eslint-disable-line react-hooks/exhaustive-deps
}
