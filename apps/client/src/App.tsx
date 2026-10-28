import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ROOM_CODE_REGEX } from '@jeopardy/shared';
import { ModalProvider } from './components/Modal';
import { Display } from './pages/Display';
import { Editor } from './pages/Editor';
import { Host } from './pages/Host';
import { Join } from './pages/Join';
import { Landing } from './pages/Landing';
import { Play } from './pages/Play';

/** Room pages take the code from the URL. Anything that isn't a valid code goes home. */
function RoomRoute({ render }: { render: (code: string) => ReactElement }) {
  const code = useParams().code?.toUpperCase() ?? '';
  if (!ROOM_CODE_REGEX.test(code)) return <Navigate to="/" replace />;
  return render(code);
}

export function App() {
  return (
    <BrowserRouter>
      <ModalProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/editor" element={<Editor />} />
          <Route
            path="/host/:code"
            element={<RoomRoute render={(code) => <Host code={code} />} />}
          />
          <Route
            path="/display/:code"
            element={<RoomRoute render={(code) => <Display code={code} />} />}
          />
          <Route path="/join" element={<Join />} />
          <Route
            path="/play/:code"
            element={<RoomRoute render={(code) => <Play code={code} />} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ModalProvider>
    </BrowserRouter>
  );
}
