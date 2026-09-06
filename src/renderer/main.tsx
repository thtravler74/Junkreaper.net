import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installDemoBridge } from './lib/demoBridge.ts';
import './styles/global.css';
import './styles/elevator.css';
import './styles/panel.css';

// Running outside Electron (`npm run dev:web`, or a `vite preview` build) means
// there is no preload bridge. Rather than branch the whole UI on that, stand up a
// mock implementation of the same interface so the app has exactly one code path.
installDemoBridge();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
