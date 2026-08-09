import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Import bundled fonts (Self-hosted via Fontsource)
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource/material-symbols-outlined/400.css';

import { App } from './ui/App';
import './ui/styles.css';

function boot() {
  const rootEl = document.getElementById('redmine-kanban-root');
  if (!rootEl) return;

  const dataUrl = rootEl.getAttribute('data-data-url');
  if (!dataUrl) return;
  const initialCurrentUserId = Number(rootEl.getAttribute('data-current-user-id'));
  if (!Number.isSafeInteger(initialCurrentUserId) || initialCurrentUserId <= 0) return;

  const queryClient = new QueryClient();

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App dataUrl={dataUrl} initialCurrentUserId={initialCurrentUserId} />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
