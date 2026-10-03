import { useEffect, useRef } from 'react';

// Windows that move items to the trash, and the trash window that restores them, tell each other
// so an open list does not keep showing an item that has moved.
export type TrashType = 'file' | 'memo' | 'price' | 'capsule';
const EVENT = 'desktop-trash-changed';

export const announceTrash = (type: TrashType) => window.dispatchEvent(new CustomEvent<TrashType>(EVENT, { detail: type }));

export function useTrashChange(type: TrashType | null, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: Event) => { if (!type || (event as CustomEvent<TrashType>).detail === type) latest.current(); };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [type]);
}
