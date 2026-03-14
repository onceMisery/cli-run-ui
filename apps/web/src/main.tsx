import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import './index.css';
import { I18nProvider } from './lib/i18n.tsx';
import { ThemeProvider } from './lib/theme.tsx';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}
