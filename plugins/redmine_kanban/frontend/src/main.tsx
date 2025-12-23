import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
