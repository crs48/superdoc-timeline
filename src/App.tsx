import { HashRouter, Route, Routes } from 'react-router-dom';
import { NameGate } from '@/components/NameGate';
import { UploadPanel } from '@/components/UploadPanel';
import { RoomView } from '@/components/RoomView';

/**
 * HashRouter, deliberately: GitHub Pages has no rewrite rules, so
 * `#/d/:roomId` deep links work with zero deploy configuration. The NameGate
 * wraps every route — a person landing on a shared link names themselves
 * before they touch the document.
 */
export default function App() {
  return (
    <HashRouter>
      <NameGate>
        <Routes>
          <Route path="/" element={<UploadPanel />} />
          <Route path="/d/:roomId" element={<RoomView />} />
        </Routes>
      </NameGate>
    </HashRouter>
  );
}
