import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (container === null) throw new Error('#root 缺失');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
