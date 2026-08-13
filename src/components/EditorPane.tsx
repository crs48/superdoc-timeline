import { useEffect, useRef, useState } from 'react';
import { BlankDOCX, type SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { mountRoom } from '@/collab/superdoc-mount';
import { takePendingUpload } from '@/store/room';
import { useRoom } from '@/store/room';
import { useIdentity } from '@/store/identity';

interface EditorPaneProps {
  roomId: string;
  onEdit: () => void;
  onConnected: () => void;
}

const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * `BlankDOCX` is a base64 data URL exported by superdoc for exactly this need —
 * but the bytes MUST be wrapped in a File carrying the DOCX MIME type. Fetching
 * the data URL yields an `application/octet-stream` blob, and handing that to a
 * v2 collaboration mount stalls the engine silently: no exception, no worker,
 * no socket. (Verified against superdoc@2.5.1; same bytes, typed, work.)
 */
async function blankDocxFile(): Promise<File> {
  const raw = await (await fetch(BlankDOCX)).blob();
  return new File([raw], 'blank.docx', { type: DOCX_TYPE });
}

/**
 * Owns the entire SuperDoc lifecycle for one room. v2 has no join-or-create and
 * no way to change roomMode on a live instance — retrying requires a fresh
 * mount — so this component's state machine is: pick a mode, mount, and on a
 * room-missing/room-exists exception destroy and remount in the other mode.
 */
export function EditorPane({ roomId, onEdit, onConnected }: EditorPaneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const deviceId = useIdentity((s) => s.deviceId);
  const name = useIdentity((s) => s.name);
  const setStatus = useRoom((s) => s.setStatus);
  const setError = useRoom((s) => s.setError);

  // An uploaded file means we intend to create; a bare link means join. The
  // retry flips this when the first guess is wrong (e.g. refresh after create).
  // The upload is consumed exactly once into a ref — render-safe under
  // StrictMode's double invocation, and stable across the mode-flip remount.
  const uploadRef = useRef<File | null>(null);
  const consumedRef = useRef(false);
  if (!consumedRef.current) {
    consumedRef.current = true;
    uploadRef.current = takePendingUpload();
  }
  const [mode, setMode] = useState<'create' | 'join'>(() =>
    uploadRef.current != null ? 'create' : 'join',
  );

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let active = true;
    let instance: SuperDoc | null = null;
    setStatus('connecting');

    async function mount() {
      const data = uploadRef.current ?? (await blankDocxFile());
      if (!active || !el) return;
      instance = mountRoom({
        el,
        roomId,
        identity: { deviceId, name },
        data,
        mode,
        onReady: () => {
          if (!active) return;
          setStatus('connected');
          onConnected();
        },
        onRetry: (nextMode) => {
          if (!active) return;
          // A create-after-join retry has no upload; seed from blank.
          if (nextMode === 'join') uploadRef.current = null;
          setMode(nextMode);
        },
        onError: (message) => {
          if (!active) return;
          setError(message);
        },
        onEdit: () => {
          if (active) onEdit();
        },
      });
    }

    void mount();

    return () => {
      active = false;
      instance?.destroy();
      // SuperDoc mounts a Vue app inside the element; clear leftovers so a
      // remount (mode flip) starts from a clean node.
      el.replaceChildren();
    };
    // identity is stable for the life of a room visit (NameGate precedes this).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mode]);

  return <div ref={mountRef} className="superdoc-mount min-h-[60vh]" />;
}
