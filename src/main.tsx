import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import { ensureDepth } from './state/engine';
import { useStore } from './state/store';
import { compositionOf, figureModels } from './ui/overlays';

if (import.meta.env.DEV) {
  Object.assign(window, { masu: { get: useStore.getState, set: useStore.setState, compositionOf, figureModels, ensureDepth } });
}

createRoot(document.getElementById('root')!).render(<App />);
