import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { case01 } from './cases/case01';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App caseData={case01} />
  </StrictMode>,
);
