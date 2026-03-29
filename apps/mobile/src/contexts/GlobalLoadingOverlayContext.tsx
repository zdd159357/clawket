import React, { useCallback, useMemo, useState } from 'react';

const EXPECTED_RESTART_GRACE_MS = 2_500;

export type GlobalLoadingOverlayContextType = {
  loadingMessage: string | null;
  overlayMessage: string | null;
  isExpectedRestartActive: boolean;
  showLoading: (message: string) => void;
  hideLoading: () => void;
  showOverlay: (message: string) => void;
  hideOverlay: () => void;
  beginExpectedRestart: () => void;
  endExpectedRestart: (graceMs?: number) => void;
};

const GlobalLoadingOverlayContext = React.createContext<GlobalLoadingOverlayContextType | null>(null);

export function GlobalLoadingOverlayProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [expectedRestartCount, setExpectedRestartCount] = useState(0);
  const [restartGraceActive, setRestartGraceActive] = useState(false);
  const restartGraceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestartGraceTimer = useCallback(() => {
    if (!restartGraceTimerRef.current) return;
    clearTimeout(restartGraceTimerRef.current);
    restartGraceTimerRef.current = null;
  }, []);

  const showLoading = useCallback((message: string) => {
    setLoadingMessage(message);
  }, []);

  const hideLoading = useCallback(() => {
    setLoadingMessage(null);
  }, []);

  const beginExpectedRestart = useCallback(() => {
    clearRestartGraceTimer();
    setRestartGraceActive(false);
    setExpectedRestartCount((count) => count + 1);
  }, [clearRestartGraceTimer]);

  const endExpectedRestart = useCallback((graceMs = EXPECTED_RESTART_GRACE_MS) => {
    setExpectedRestartCount((count) => {
      const nextCount = Math.max(0, count - 1);
      if (nextCount === 0) {
        clearRestartGraceTimer();
        if (graceMs > 0) {
          setRestartGraceActive(true);
          restartGraceTimerRef.current = setTimeout(() => {
            setRestartGraceActive(false);
            restartGraceTimerRef.current = null;
          }, graceMs);
        } else {
          setRestartGraceActive(false);
        }
      }
      return nextCount;
    });
  }, [clearRestartGraceTimer]);

  React.useEffect(() => () => {
    clearRestartGraceTimer();
  }, [clearRestartGraceTimer]);

  const isExpectedRestartActive = expectedRestartCount > 0 || restartGraceActive;

  const value = useMemo(
    () => ({
      loadingMessage,
      overlayMessage: loadingMessage,
      isExpectedRestartActive,
      showLoading,
      hideLoading,
      showOverlay: showLoading,
      hideOverlay: hideLoading,
      beginExpectedRestart,
      endExpectedRestart,
    }),
    [
      loadingMessage,
      isExpectedRestartActive,
      showLoading,
      hideLoading,
      beginExpectedRestart,
      endExpectedRestart,
    ],
  );

  return (
    <GlobalLoadingOverlayContext.Provider value={value}>
      {children}
    </GlobalLoadingOverlayContext.Provider>
  );
}

export function useGlobalLoadingOverlay(): GlobalLoadingOverlayContextType {
  const context = React.useContext(GlobalLoadingOverlayContext);
  if (!context) {
    throw new Error('useGlobalLoadingOverlay must be used within GlobalLoadingOverlayProvider');
  }
  return context;
}

// Backward-compatible Gateway-specific aliases.
export type GatewayOverlayContextType = GlobalLoadingOverlayContextType;
export const GatewayOverlayProvider = GlobalLoadingOverlayProvider;
export const useGatewayOverlay = useGlobalLoadingOverlay;
