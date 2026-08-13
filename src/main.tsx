import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * No StrictMode, deliberately. Its dev-only double-invoked effects mount the
 * SuperDoc v2 runtime twice in quick succession; destroying the first instance
 * while its collaboration worker is mid-boot leaves the second instance unable
 * to open the room (it hangs before the WebSocket, with no exception). One
 * editor instance per mount is a hard requirement of the v2 runtime, so the
 * usual "make effects idempotent" answer does not apply here.
 */
createRoot(document.getElementById('root')!).render(<App />);
