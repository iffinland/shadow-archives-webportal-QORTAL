import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { AppProviders } from './app/providers';
import { createAppRouter } from './app/router/router';
import { RootErrorBoundary } from './components/feedback';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/content.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Shadow Archives: #root container is missing');
}

const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>,
);
