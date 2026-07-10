import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: 'https://9ca93bac9e63dfbd8cc3d84078677fb6@o4511704565678080.ingest.de.sentry.io/4511706868023376',
    integrations: [Sentry.browserTracingIntegration(), Sentry.browserProfilingIntegration()],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
}

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
} catch (err) {
  const root = document.getElementById('root')!;
  root.style.cssText = 'background:#0a0a0a;color:#ff4444;padding:1.5rem;font-family:monospace;font-size:0.8125rem;white-space:pre-wrap;overflow:auto';
  root.textContent = 'React mount error:\n' + (err instanceof Error ? err.stack : String(err));
}
