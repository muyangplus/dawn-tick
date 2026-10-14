import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installLogHandlers } from './log.ts';
import { installWebviewGuards } from './webview-guard.ts';

installWebviewGuards();
// 先装日志兜底：之后任何未捕获异常都会进日志，不再静默失败
installLogHandlers();

const container = document.getElementById('root');
if (container === null) throw new Error('#root 缺失');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
