import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tailwind.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/widgets.css';
import './styles/admin.css';
import './styles/settings.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
