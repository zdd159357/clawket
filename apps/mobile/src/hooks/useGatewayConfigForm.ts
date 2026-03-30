import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GatewayClient } from '../services/gateway';
import { useGatewayOverlay } from '../contexts/GatewayOverlayContext';
import { useProPaywall } from '../contexts/ProPaywallContext';
import { analyticsEvents } from '../services/analytics/events';
import { StorageService } from '../services/storage';
import { GatewayConfig, GatewayMode, SavedGatewayConfig } from '../types';
import { isUnsupportedDirectLocalTlsConfig, shouldSuppressDuplicatePairingAlert } from './gatewayConfigForm.utils';
import {
  claimRelayPairing as claimRelayPairingPayload,
  buildDefaultName,
  createGatewayConfigFromScan,
  reconnectGatewayWithOverlay,
  toRuntimeConfig,
  willCreateGatewayConfigFromScan,
  type GatewayScanPayload,
} from './gatewayScanFlow';
import { canAddGatewayConnection } from '../utils/pro';

type Params = {
  gateway: GatewayClient;
  initialConfig: GatewayConfig | null;
  debugMode: boolean;
  onSaved: (config: GatewayConfig, nextGatewayScopeId?: string | null) => void;
  onReset: () => void;
};

type GatewayAuthMethod = 'token' | 'password';
type EditorTabPreference = 'quick' | 'manual';

function toEditorMode(mode: GatewayMode): GatewayMode {
  return mode === 'relay' ? 'relay' : 'custom';
}

function getCreateEditorMode(): GatewayMode {
  return 'custom';
}

function detectAuthMethod(token?: string, password?: string): GatewayAuthMethod {
  if ((token ?? '').trim()) return 'token';
  if ((password ?? '').trim()) return 'password';
  return 'token';
}

export function useGatewayConfigForm({ gateway, initialConfig, debugMode, onSaved, onReset }: Params) {
  const { t } = useTranslation('common');
  const { t: tConfig } = useTranslation('config');
  const { showOverlay, hideOverlay } = useGatewayOverlay();
  const { isPro, showPaywall } = useProPaywall();
  const [configs, setConfigs] = useState<SavedGatewayConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>('loading...');

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [editorPreferredTab, setEditorPreferredTab] = useState<EditorTabPreference>('quick');
  const [editorMode, setEditorMode] = useState<GatewayMode>(getCreateEditorMode);
  const [editorName, setEditorName] = useState('');
  const [editorUrl, setEditorUrl] = useState('');
  const [editorToken, setEditorToken] = useState('');
  const [editorPassword, setEditorPassword] = useState('');
  const [editorAuthMethodState, setEditorAuthMethodState] = useState<GatewayAuthMethod>('token');
  const [editorRelayServerUrl, setEditorRelayServerUrl] = useState('');
  const [editorRelayGatewayId, setEditorRelayGatewayId] = useState('');
  const [editorRelayClientToken, setEditorRelayClientToken] = useState('');
  const [editorRelayProtocolVersion, setEditorRelayProtocolVersion] = useState<number | undefined>(undefined);
  const [editorRelaySupportsBootstrap, setEditorRelaySupportsBootstrap] = useState<boolean | undefined>(undefined);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relayClaimInFlightRef = useRef<Map<string, Promise<GatewayScanPayload>>>(new Map());
  const lastPairingAlertRef = useRef<{ message: string; atMs: number }>({ message: '', atMs: 0 });

  useEffect(() => {
    let active = true;

    StorageService.getGatewayConfigsState()
      .then((savedState) => {
        if (!active) return;
        setConfigs(savedState.configs);
        setActiveConfigId(savedState.activeId);

        if (savedState.configs.length === 0 && initialConfig?.url) {
          const now = Date.now();
          const migrated: SavedGatewayConfig = {
            id: `legacy_${now}`,
            name: buildDefaultName('custom', initialConfig.url, 1),
            mode: 'custom',
            url: initialConfig.url,
            token: initialConfig.token,
            password: initialConfig.password,
            createdAt: now,
            updatedAt: now,
          };
          const nextState = { activeId: migrated.id, configs: [migrated] };
          void StorageService.setGatewayConfigsState(nextState);
          setConfigs(nextState.configs);
          setActiveConfigId(nextState.activeId);
        }
      })
      .catch(() => {
        if (!active) return;
        setConfigs([]);
        setActiveConfigId(null);
      });

    gateway
      .getDeviceIdentity()
      .then((identity) => {
        if (!active) return;
        setDeviceId(identity.deviceId);
      })
      .catch(() => {
        if (!active) return;
        setDeviceId('unavailable');
      });

    return () => {
      active = false;
    };
  }, [gateway, initialConfig]);

  const activeConfig = useMemo(
    () => (activeConfigId ? configs.find((item) => item.id === activeConfigId) ?? null : null),
    [activeConfigId, configs],
  );
  const isRelayEditorLocked = Boolean(editingConfigId && editorMode === 'relay');

  const closeEditor = useCallback(() => {
    setEditorVisible(false);
    setEditingConfigId(null);
  }, []);

  const setEditorAuthMethod = useCallback((method: GatewayAuthMethod) => {
    setEditorAuthMethodState(method);
    if (method === 'token') {
      setEditorPassword('');
      return;
    }
    setEditorToken('');
  }, []);

  const setEditorTokenValue = useCallback((value: string) => {
    setEditorAuthMethodState('token');
    setEditorToken(value);
    if (value.trim()) {
      setEditorPassword('');
    }
  }, []);

  const setEditorPasswordValue = useCallback((value: string) => {
    setEditorAuthMethodState('password');
    setEditorPassword(value);
    if (value.trim()) {
      setEditorToken('');
    }
  }, []);

  const openCreateEditor = useCallback((preferredTab: EditorTabPreference = 'quick') => {
    if (!canAddGatewayConnection(configs.length, isPro)) {
      showPaywall('gatewayConnections');
      return;
    }
    setEditorPreferredTab(preferredTab);
    setEditingConfigId(null);
    setEditorMode(getCreateEditorMode());
    setEditorName('');
    setEditorUrl('');
    setEditorToken('');
    setEditorPassword('');
    setEditorAuthMethodState('token');
    setEditorRelayServerUrl('');
    setEditorRelayGatewayId('');
    setEditorRelayClientToken('');
    setEditorRelayProtocolVersion(undefined);
    setEditorRelaySupportsBootstrap(undefined);
    setEditorVisible(true);
  }, [configs.length, isPro, showPaywall]);

  const openEditEditor = useCallback((configId: string) => {
    const existing = configs.find((item) => item.id === configId);
    if (!existing) return;
    setEditingConfigId(existing.id);
    setEditorMode(toEditorMode(existing.mode));
    setEditorName(existing.name);
    setEditorUrl(existing.url);
    setEditorToken(existing.token ?? '');
    setEditorPassword(existing.password ?? '');
    setEditorAuthMethodState(detectAuthMethod(existing.token, existing.password));
    setEditorRelayServerUrl(existing.relay?.serverUrl ?? '');
    setEditorRelayGatewayId(existing.relay?.gatewayId ?? '');
    setEditorRelayClientToken(existing.relay?.clientToken ?? '');
    setEditorRelayProtocolVersion(existing.relay?.protocolVersion);
    setEditorRelaySupportsBootstrap(existing.relay?.supportsBootstrap);
    setEditorVisible(true);
  }, [configs]);

  // Disconnect old connection, apply new config, and reconnect.
  // Shows a loading overlay for at least MIN_SWITCH_DURATION_MS.
  const reconnectGateway = useCallback((runtimeConfig: GatewayConfig, nextGatewayScopeId?: string | null) => {
    reconnectGatewayWithOverlay({
      gateway,
      runtimeConfig,
      nextGatewayScopeId,
      onSaved,
      showOverlay,
      hideOverlay,
      message: t('Switching Gateway...'),
      switchTimerRef,
    });
  }, [t, gateway, onSaved, showOverlay, hideOverlay]);

  // Clean up switch timer on unmount
  useEffect(() => {
    return () => {
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    };
  }, []);

  const activateConfig = useCallback(async (configId: string): Promise<void> => {
    const target = configs.find((item) => item.id === configId);
    if (!target || configId === activeConfigId) return;

    setActiveConfigId(configId);
    showOverlay(t('Switching Gateway...'));

    await StorageService.setGatewayConfigsState({ activeId: configId, configs });

    reconnectGateway(toRuntimeConfig(target, debugMode), `cfg:${target.id}`);
  }, [t, activeConfigId, configs, debugMode, reconnectGateway, showOverlay]);

  const saveEditor = useCallback(async (): Promise<void> => {
    const trimmedUrl = editorUrl.trim();
    const trimmedToken = editorToken.trim();
    const trimmedPassword = editorPassword.trim();
    const trimmedServerUrl = editorRelayServerUrl.trim();
    const trimmedRelayGatewayId = editorRelayGatewayId.trim();
    const trimmedRelayClientToken = editorRelayClientToken.trim();
    const now = Date.now();

    if (!trimmedUrl) {
      Alert.alert(tConfig('Missing URL'), tConfig('Gateway URL is required.'));
      return;
    }

    const selectedCredential = editorAuthMethodState === 'token' ? trimmedToken : trimmedPassword;
    if (editorMode !== 'relay' && !selectedCredential) {
      Alert.alert(tConfig('Missing Auth'), tConfig('Auth Token or Password is required.'));
      return;
    }

    if (editorMode === 'relay' && !trimmedServerUrl) {
      Alert.alert(tConfig('Missing Pair Server URL'), tConfig('Relay pair server URL is required in Relay mode.'));
      return;
    }

    if (editorMode === 'relay' && !trimmedRelayGatewayId) {
      Alert.alert(tConfig('Missing Gateway ID'), tConfig('Relay gateway ID is required in Relay mode.'));
      return;
    }

    if (editorMode === 'relay' && !trimmedRelayClientToken) {
      Alert.alert(tConfig('Missing Relay Pairing'), tConfig('Scan a Bridge QR code to import the Relay pairing credential.'));
      return;
    }

    const trimmedName = editorName.trim() || buildDefaultName(editorMode, trimmedUrl, configs.length + 1);
    const token = editorAuthMethodState === 'token' ? (trimmedToken || undefined) : undefined;
    const password = editorAuthMethodState === 'password' ? (trimmedPassword || undefined) : undefined;
    const relay = editorMode === 'relay'
      ? {
        serverUrl: trimmedServerUrl,
        gatewayId: trimmedRelayGatewayId,
        clientToken: trimmedRelayClientToken,
        ...(editorRelayProtocolVersion !== undefined ? { protocolVersion: editorRelayProtocolVersion } : {}),
        ...(editorRelaySupportsBootstrap !== undefined ? { supportsBootstrap: editorRelaySupportsBootstrap } : {}),
      }
      : undefined;

    if (editingConfigId) {
      const existing = configs.find((item) => item.id === editingConfigId);
      if (!existing) {
        Alert.alert(tConfig('Not Found'), tConfig('The selected gateway config no longer exists.'));
        return;
      }

      const updated: SavedGatewayConfig = {
        ...existing,
        name: trimmedName,
        mode: editorMode,
        url: trimmedUrl,
        token,
        password,
        relay,
        updatedAt: now,
      };
      const nextConfigs = configs.map((item) => (item.id === editingConfigId ? updated : item));
      const nextActiveId = activeConfigId;
      await StorageService.setGatewayConfigsState({ activeId: nextActiveId, configs: nextConfigs });

      setConfigs(nextConfigs);
      setEditorVisible(false);
      setEditingConfigId(null);
      analyticsEvents.gatewayConnectSaved({
        is_editing: true,
        mode: editorMode,
        has_password: Boolean(password),
        has_token: Boolean(token),
        source: 'config_editor',
      });

      if (activeConfigId === editingConfigId) {
        reconnectGateway(toRuntimeConfig(updated, debugMode), `cfg:${updated.id}`);
      }
      return;
    }

    const created: SavedGatewayConfig = {
      id: `gateway_${now}`,
      name: trimmedName,
      mode: editorMode,
      url: trimmedUrl,
      token,
      password,
      relay,
      createdAt: now,
      updatedAt: now,
    };

    const nextConfigs = [...configs, created];
    const nextActiveId = created.id;
    await StorageService.setGatewayConfigsState({ activeId: nextActiveId, configs: nextConfigs });

    setConfigs(nextConfigs);
    setActiveConfigId(nextActiveId);
    setEditorVisible(false);
    analyticsEvents.gatewayConnectSaved({
      is_editing: false,
      mode: editorMode,
      has_password: Boolean(password),
      has_token: Boolean(token),
      source: 'config_editor',
    });

    reconnectGateway(toRuntimeConfig(created, debugMode), `cfg:${created.id}`);
  }, [
    activeConfigId,
    configs,
    debugMode,
    editingConfigId,
    editorMode,
    editorAuthMethodState,
    editorName,
    editorRelayGatewayId,
    editorRelayClientToken,
    editorRelayServerUrl,
    editorPassword,
    editorRelayProtocolVersion,
    editorRelaySupportsBootstrap,
    editorToken,
    editorUrl,
    reconnectGateway,
  ]);

  const showPairingFailedAlert = useCallback((message: string) => {
    const now = Date.now();
    if (
      shouldSuppressDuplicatePairingAlert(
        lastPairingAlertRef.current.message,
        lastPairingAlertRef.current.atMs,
        message,
        now,
      )
    ) {
      return;
    }
    lastPairingAlertRef.current = { message, atMs: now };
    hideOverlay();
    Alert.alert('Pairing Failed', message);
  }, [hideOverlay]);

  const claimRelayPairing = useCallback(async (payload: GatewayScanPayload): Promise<GatewayScanPayload> => {
    return claimRelayPairingPayload(payload, relayClaimInFlightRef);
  }, []);

  const applyScannedConfig = useCallback(async (payload: GatewayScanPayload): Promise<void> => {
    let resolved = payload;
    showOverlay(t('Switching Gateway...'));
    try {
      resolved = payload.relay?.accessCode ? await claimRelayPairing(payload) : payload;
    } catch (error) {
      showPairingFailedAlert(error instanceof Error ? error.message : 'Could not claim this Bridge pairing code.');
      return;
    }
    const trimmedUrl = resolved.url.trim();
    if (!trimmedUrl) {
      showPairingFailedAlert('The scanned QR code did not return a usable Relay URL.');
      return;
    }
    if (isUnsupportedDirectLocalTlsConfig({
      url: trimmedUrl,
      hasRelayConfig: Boolean(resolved.relay?.gatewayId),
    })) {
      showPairingFailedAlert(t('Direct local TLS gateway connections are not supported in Clawket mobile yet. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.', { ns: 'chat' }));
      return;
    }

    const nextMode = resolved.mode === 'relay' || resolved.relay ? 'relay' : 'custom';
    const preserveRelayFallbackCredentials = nextMode === 'relay' && Boolean(editingConfigId);
    const suggestedName = resolved.relay?.displayName?.trim()
      || buildDefaultName(nextMode, trimmedUrl, configs.length + 1);

    if (!editorVisible) {
      setEditingConfigId(null);
      setEditorVisible(true);
    }

    if (!editingConfigId) {
      setEditorName((prev) => (prev.trim() ? prev : suggestedName));
    }
    setEditorMode(nextMode);
    setEditorUrl(trimmedUrl);
    setEditorToken(preserveRelayFallbackCredentials ? (resolved.token ?? editorToken) : (resolved.token ?? ''));
    setEditorPassword(preserveRelayFallbackCredentials ? (resolved.password ?? editorPassword) : (resolved.password ?? ''));
    setEditorAuthMethodState(detectAuthMethod(
      preserveRelayFallbackCredentials ? (resolved.token ?? editorToken) : resolved.token,
      preserveRelayFallbackCredentials ? (resolved.password ?? editorPassword) : resolved.password,
    ));
    setEditorRelayServerUrl(resolved.relay?.serverUrl ?? '');
    setEditorRelayGatewayId(resolved.relay?.gatewayId ?? '');
    setEditorRelayClientToken(
      preserveRelayFallbackCredentials ? (resolved.relay?.clientToken ?? editorRelayClientToken) : (resolved.relay?.clientToken ?? ''),
    );
    setEditorRelayProtocolVersion(
      preserveRelayFallbackCredentials
        ? (resolved.relay?.protocolVersion ?? editorRelayProtocolVersion)
        : resolved.relay?.protocolVersion,
    );
    setEditorRelaySupportsBootstrap(
      preserveRelayFallbackCredentials
        ? (resolved.relay?.supportsBootstrap ?? editorRelaySupportsBootstrap)
        : resolved.relay?.supportsBootstrap,
    );
  }, [
    claimRelayPairing,
    configs.length,
    editingConfigId,
    editorPassword,
    editorRelayClientToken,
    editorRelayProtocolVersion,
    editorRelaySupportsBootstrap,
    editorToken,
    editorVisible,
    showOverlay,
    showPairingFailedAlert,
    t,
  ]);

  // Create a new gateway config from scanned QR data and activate it immediately.
  const createFromScan = useCallback(async (payload: GatewayScanPayload): Promise<void> => {
    if (!canAddGatewayConnection(configs.length, isPro) && willCreateGatewayConfigFromScan(configs, payload)) {
      hideOverlay();
      showPaywall('gatewayConnections');
      return;
    }
    let resolved = payload;
    showOverlay(t('Switching Gateway...'));
    try {
      resolved = payload.relay?.accessCode ? await claimRelayPairing(payload) : payload;
    } catch (error) {
      showPairingFailedAlert(error instanceof Error ? error.message : 'Could not claim this Bridge pairing code.');
      return;
    }
    const trimmedUrl = resolved.url.trim();
    if (!trimmedUrl) {
      hideOverlay();
      return;
    }
    if (isUnsupportedDirectLocalTlsConfig({
      url: trimmedUrl,
      hasRelayConfig: Boolean(resolved.relay?.gatewayId),
    })) {
      showPairingFailedAlert(t('Direct local TLS gateway connections are not supported in Clawket mobile yet. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.', { ns: 'chat' }));
      return;
    }

    const { created, nextConfigs } = await createGatewayConfigFromScan({
      payload: resolved,
      debugMode,
    });

    setConfigs(nextConfigs);
    setActiveConfigId(created.id);
    setEditorVisible(false);
    reconnectGateway(toRuntimeConfig(created, debugMode), `cfg:${created.id}`);
  }, [claimRelayPairing, configs, debugMode, hideOverlay, isPro, reconnectGateway, showOverlay, showPairingFailedAlert, showPaywall, t]);

  const deleteConfig = useCallback((configId: string) => {
    const target = configs.find((item) => item.id === configId);
    if (!target) return;

    Alert.alert(
      tConfig('Delete Gateway'),
      tConfig('Are you sure you want to delete "{{name}}"?', { name: target.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            const nextConfigs = configs.filter((item) => item.id !== configId);
            const wasActive = activeConfigId === configId;
            const nextActiveId = wasActive ? (nextConfigs[0]?.id ?? null) : activeConfigId;

            await StorageService.setGatewayConfigsState({ activeId: nextActiveId, configs: nextConfigs });
            setConfigs(nextConfigs);
            setActiveConfigId(nextActiveId);

            if (wasActive) {
              const nextActive = nextConfigs.find((item) => item.id === nextActiveId);
              if (nextActive) {
                reconnectGateway(toRuntimeConfig(nextActive, debugMode), `cfg:${nextActive.id}`);
              } else {
                gateway.disconnect();
                onReset();
              }
            }
          },
        },
      ],
    );
  }, [activeConfigId, configs, debugMode, gateway, onReset, reconnectGateway, t, tConfig]);

  const resetDevice = useCallback(() => {
    Alert.alert(
      tConfig('Reset Device'),
      tConfig('This will clear your device identity, auth token, pairing state, and all saved gateways. You will need to reconfigure and re-pair with the Gateway.\n\nContinue?'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: tConfig('Reset'),
          style: 'destructive',
          onPress: async () => {
            gateway.disconnect();
            await StorageService.clearIdentity();
            await StorageService.clearGatewayConfig();
            setConfigs([]);
            setActiveConfigId(null);
            setEditorVisible(false);
            setEditingConfigId(null);
            setEditorName('');
            setEditorUrl('');
            setEditorToken('');
            setEditorPassword('');
            setEditorAuthMethodState('token');
            setEditorRelayServerUrl('');
            setEditorRelayGatewayId('');
            setEditorRelayClientToken('');
            setEditorMode('custom');
            try {
              const newIdentity = await gateway.getDeviceIdentity();
              setDeviceId(newIdentity.deviceId);
            } catch {
              setDeviceId('unavailable');
            }
            onReset();
          },
        },
      ],
    );
  }, [gateway, onReset, t, tConfig]);

  return {
    configs,
    activeConfigId,
    activeConfig,
    deviceId,
    editorVisible,
    editingConfigId,
    isRelayEditorLocked,
    editorPreferredTab,
    editorMode,
    editorName,
    editorUrl,
    editorToken,
    editorPassword,
    editorRelayServerUrl,
    editorRelayGatewayId,
    editorRelayClientToken,
    setEditorMode,
    setEditorName,
    setEditorUrl,
    setEditorToken: setEditorTokenValue,
    setEditorPassword: setEditorPasswordValue,
    editorAuthMethod: editorAuthMethodState,
    setEditorAuthMethod,
    setEditorRelayServerUrl,
    setEditorRelayGatewayId,
    setEditorRelayClientToken,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    saveEditor,
    activateConfig,
    deleteConfig,
    applyScannedConfig,
    createFromScan,
    resetDevice,
  };
}
