import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { UIErrorBoundary } from './ui/UIErrorBoundary';
import './styles/index.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIErrorBoundary scope="app" onReset={() => window.location.reload()}>
      <App />
    </UIErrorBoundary>
  </React.StrictMode>,
);
