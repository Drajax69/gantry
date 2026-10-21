'use client';

import { useEffect, useId } from 'react';

const drafts = new Map<string, () => void>();
const warning = 'Leave without saving? Your unsaved graph or instruction changes will be lost.';

/** Called before app-state navigation, which does not trigger beforeunload. */
export function confirmGraphNavigation() {
  if (!drafts.size) return true;
  if (!window.confirm(warning)) return false;
  const discard = [...drafts.values()];
  drafts.clear();
  discard.forEach(fn => fn());
  return true;
}

/** Each nested editor owns its draft, so closing a node needn't discard the canvas. */
export function useUnsavedGraph(dirty: boolean, onDiscard?: () => void) {
  const id = useId();
  useEffect(() => {
    if (dirty) drafts.set(id, () => onDiscard?.());
    return () => { drafts.delete(id); };
  }, [id, dirty, onDiscard]);
  return {
    markSaved: () => { drafts.delete(id); },
    confirmDiscard: () => {
      if (!dirty) return true;
      if (!window.confirm(warning)) return false;
      drafts.delete(id);
      onDiscard?.();
      return true;
    },
  };
}

export function useGraphNavigationGuard() {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!drafts.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      if (link.href === window.location.href) return;
      if (!confirmGraphNavigation()) { event.preventDefault(); event.stopPropagation(); }
    };
    // Electron/Chromium supports cancellable history navigation. Full-document
    // navigation also has the native beforeunload fallback.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType !== 'traverse' || !event.cancelable) return;
      if (!confirmGraphNavigation()) event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', navigate);
    };
  }, []);
}
