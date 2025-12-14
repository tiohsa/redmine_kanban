import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

function boot() {
  const rootEl = document.getElementById('redmine-kanban-root');
  if (!rootEl) return;

  const dataUrl = rootEl.getAttribute('data-data-url');
  if (!dataUrl) return;

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App dataUrl={dataUrl} />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

