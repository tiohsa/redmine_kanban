import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Import bundled fonts (Self-hosted via Fontsource)
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/outfit';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/material-symbols-outlined';

import { App } from './ui/App';
import './ui/styles.css';

function boot() {
  const rootEl = document.getElementById('redmine-kanban-root');
  if (!rootEl) return;

  const dataUrl = rootEl.getAttribute('data-data-url');
  if (!dataUrl) return;

  const queryClient = new QueryClient();

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App dataUrl={dataUrl} />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
