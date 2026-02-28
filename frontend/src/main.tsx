import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'

const queryClient = new QueryClient();

const root = createRoot(document.getElementById('root')!);

async function waitForFonts() {
  await Promise.all([
    document.fonts.load('400 16px "PT Sans"'),
    document.fonts.load('700 16px "PT Sans"'),
  ]);
  await document.fonts.ready;
}

waitForFonts().then(() => {
  const rootEl = document.getElementById('root')!;
  rootEl.style.opacity = '0';

  root.render(
    // <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
    // </StrictMode>,
  );

  // Ждём 2 кадра — React отрендерил, CSS применён, layout стабилен
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      rootEl.style.opacity = '1';
    });
  });
});
