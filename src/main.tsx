import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/russo-one/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@/ui/theme.css';
import App from '@/App';
import { installDebug } from '@/game/debug';

installDebug();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
