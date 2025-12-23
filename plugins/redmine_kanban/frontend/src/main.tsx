import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './ui/queries';

function boot() {
  const rootEl = document.getElementById('redmine-kanban-root');
  if (!rootEl) return;

  const dataUrl = rootEl.getAttribute('data-data-url');
  if (!dataUrl) return;

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
