import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type OpenClawInfo = {
  configFound: boolean;
  gatewayPort: number | null;
  authMode: 'token' | 'password' | null;
  token: string | null;
  password: string | null;
};

export type DeviceBootstrapTokenRecord = {
  token: string;
  ts: number;
  deviceId?: string;
  publicKey?: string;
  roles?: string[];
  scopes?: string[];
  issuedAtMs: number;
  lastUsedAtMs?: number;
};

export type OpenClawLanConfigResult = {
  configPath: string;
  bindChanged: boolean;
  allowedOriginAdded: boolean;
  allowedOrigins: string[];
  controlUiOrigin: string;
};

export type OpenClawGatewayRestartResult = {
  action: 'restarted' | 'started';
  result: string;
  message: string | null;
  warnings: string[];
};

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';
export const DEVICE_BOOTSTRAP_TOKEN_TTL_MS = 10 * 60 * 1000;
const BOOTSTRAP_FILENAME = 'bootstrap.json';
const PAIRING_TOKEN_BYTES = 32;
const OPENCLAW_CLI_COMMAND = 'openclaw';

type OpenClawPaths = {
  stateDir: string;
  configDir: string;
  configPath: string;
  mediaDir: string;
};

type DeviceBootstrapStateFile = Record<string, DeviceBootstrapTokenRecord>;

const withBootstrapLock = createAsyncLock();

export function resolveGatewayUrl(explicitUrl?: string | null): string {
  const trimmed = explicitUrl?.trim();
  if (trimmed) return trimmed;
  const info = readOpenClawInfo();
  if (typeof info.gatewayPort === 'number') {
    return `ws://127.0.0.1:${info.gatewayPort}`;
  }
  return DEFAULT_GATEWAY_URL;
}

export function readOpenClawInfo(): OpenClawInfo {
  const openclaw = resolveOpenClawPaths();
  if (!existsSync(openclaw.configPath)) {
    return {
      configFound: false,
      gatewayPort: null,
      authMode: null,
      token: readGatewayTokenEnv(),
      password: readGatewayPasswordEnv(),
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(openclaw.configPath, 'utf8')) as {
      gateway?: { port?: unknown; auth?: { mode?: unknown; token?: unknown; password?: unknown } };
    };
    const rawPort = parsed.gateway?.port;
    const gatewayPort = typeof rawPort === 'number' && Number.isInteger(rawPort) ? rawPort : null;
    const authMode = parsed.gateway?.auth?.mode === 'token' || parsed.gateway?.auth?.mode === 'password'
      ? parsed.gateway.auth.mode
      : null;
    const token = readConfiguredSecret(parsed.gateway?.auth?.token) ?? readGatewayTokenEnv();
    const password = readConfiguredSecret(parsed.gateway?.auth?.password) ?? readGatewayPasswordEnv();
    return {
      configFound: true,
      gatewayPort,
      authMode,
      token,
      password,
    };
  } catch {
    return {
      configFound: true,
      gatewayPort: null,
      authMode: null,
      token: readGatewayTokenEnv(),
      password: readGatewayPasswordEnv(),
    };
  }
}

export function resolveGatewayToken(): string | null {
  return readOpenClawInfo().token;
}

export function resolveGatewayPassword(): string | null {
  return readOpenClawInfo().password;
}

export function resolveGatewayAuth():
  | { token: string; password: null; label: 'token' }
  | { token: null; password: string; label: 'password' }
  | { token: string; password: string; label: 'token' | 'password'; error: string }
  | { token: null; password: null; label: null }
{
  const info = readOpenClawInfo();
  const token = info.token;
  const password = info.password;
  if (token && password && info.authMode == null) {
    return {
      token,
      password,
      label: 'token',
      error: 'OpenClaw has both gateway token and password configured, but gateway.auth.mode is unset. Set the mode to token or password before pairing.',
    };
  }
  if (info.authMode === 'password') {
    return password
      ? { token: null, password, label: 'password' }
      : { token: null, password: null, label: null };
  }
  if (info.authMode === 'token') {
    return token
      ? { token, password: null, label: 'token' }
      : { token: null, password: null, label: null };
  }
  if (token) {
    return { token, password: null, label: 'token' };
  }
  if (password) {
    return { token: null, password, label: 'password' };
  }
  return { token: null, password: null, label: null };
}

export function getOpenClawConfigDir(): string {
  return resolveOpenClawPaths().configDir;
}

export function getOpenClawStateDir(): string {
  return resolveOpenClawPaths().stateDir;
}

export function getOpenClawMediaDir(): string {
  return resolveOpenClawPaths().mediaDir;
}

export function getOpenClawConfigPath(): string {
  return resolveOpenClawPaths().configPath;
}

export function getOpenClawConfigCandidates(): string[] {
  return buildOpenClawStateDirCandidates();
}

export async function configureOpenClawLanAccess(params: {
  controlUiOrigin: string;
}): Promise<OpenClawLanConfigResult> {
  const openclaw = resolveOpenClawPaths();
  if (!existsSync(openclaw.configPath)) {
    throw new Error(
      `OpenClaw config was not found at ${openclaw.configPath}. Run OpenClaw setup first, then retry local pairing.`,
    );
  }

  const controlUiOrigin = normalizeControlUiOrigin(params.controlUiOrigin);
  const currentBind = await readOpenClawConfigString('gateway.bind', openclaw);
  const currentAllowedOrigins = await readOpenClawAllowedOrigins(openclaw);

  let bindChanged = false;
  if (currentBind !== 'lan') {
    await runOpenClawCli(['config', 'set', 'gateway.bind', 'lan'], openclaw);
    bindChanged = true;
  }

  const allowedOrigins = appendUniqueOrigin(currentAllowedOrigins, controlUiOrigin);
  const allowedOriginAdded = allowedOrigins.length !== currentAllowedOrigins.length;
  if (allowedOriginAdded) {
    await runOpenClawCli(
      [
        'config',
        'set',
        'gateway.controlUi.allowedOrigins',
        JSON.stringify(allowedOrigins),
        '--strict-json',
      ],
      openclaw,
    );
  }

  return {
    configPath: openclaw.configPath,
    bindChanged,
    allowedOriginAdded,
    allowedOrigins,
    controlUiOrigin,
  };
}

export type OpenClawDoctorCheckResult = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip' | string;
  message?: string;
};

export type OpenClawDoctorResult = {
  ok: boolean;
  checks: OpenClawDoctorCheckResult[];
  summary: string;
  raw?: string;
};

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult> {
  const openclaw = resolveOpenClawPaths();
  try {
    const { stdout } = await runOpenClawCli(['doctor', '--json'], openclaw);
    try {
      const parsed = parseEmbeddedJsonValue(stdout) as {
        ok?: boolean;
        checks?: unknown[];
        summary?: string;
      };
      const checks: OpenClawDoctorCheckResult[] = Array.isArray(parsed.checks)
        ? parsed.checks
          .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
          .map((c) => ({
            name: typeof c.name === 'string' ? c.name : 'unknown',
            status: typeof c.status === 'string' ? c.status : 'unknown',
            message: typeof c.message === 'string' ? c.message : undefined,
          }))
        : [];
      return {
        ok: parsed.ok === true,
        checks,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      };
    } catch {
      // --json not supported or output not JSON; return raw stdout
      return {
        ok: true,
        checks: [],
        summary: '',
        raw: stripAnsi(stdout.trim()),
      };
    }
  } catch (error) {
    // doctor may exit non-zero when issues are found; try to parse stdout
    if (isExecFileError(error) && typeof error.stdout === 'string' && error.stdout.trim()) {
      try {
        const parsed = parseEmbeddedJsonValue(error.stdout) as {
          ok?: boolean;
          checks?: unknown[];
          summary?: string;
        };
        const checks: OpenClawDoctorCheckResult[] = Array.isArray(parsed.checks)
          ? parsed.checks
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
            .map((c) => ({
              name: typeof c.name === 'string' ? c.name : 'unknown',
              status: typeof c.status === 'string' ? c.status : 'unknown',
              message: typeof c.message === 'string' ? c.message : undefined,
            }))
          : [];
        return {
          ok: parsed.ok === true,
          checks,
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        };
      } catch {
        return {
          ok: false,
          checks: [],
          summary: '',
          raw: stripAnsi(error.stdout.trim()),
        };
      }
    }
    // If --json is not supported, try without --json
    try {
      const { stdout } = await runOpenClawCli(['doctor'], openclaw);
      return {
        ok: true,
        checks: [],
        summary: '',
        raw: stripAnsi(stdout.trim()),
      };
    } catch (fallbackError) {
      if (isExecFileError(fallbackError) && typeof fallbackError.stdout === 'string' && fallbackError.stdout.trim()) {
        return {
          ok: false,
          checks: [],
          summary: '',
          raw: stripAnsi(fallbackError.stdout.trim()),
        };
      }
      throw formatOpenClawCliError(['doctor'], error);
    }
  }
}

export type OpenClawDoctorFixResult = {
  ok: boolean;
  summary: string;
  raw?: string;
};

export async function runOpenClawDoctorFix(): Promise<OpenClawDoctorFixResult> {
  const openclaw = resolveOpenClawPaths();
  try {
    const { stdout } = await runOpenClawCli(['doctor', '--fix'], openclaw);
    return {
      ok: true,
      summary: '',
      raw: stripAnsi(stdout.trim()),
    };
  } catch (error) {
    if (isExecFileError(error) && typeof error.stdout === 'string' && error.stdout.trim()) {
      return {
        ok: false,
        summary: '',
        raw: stripAnsi(error.stdout.trim()),
      };
    }
    throw formatOpenClawCliError(['doctor', '--fix'], error);
  }
}

export async function restartOpenClawGateway(): Promise<OpenClawGatewayRestartResult> {
  const openclaw = resolveOpenClawPaths();
  const restart = await runOpenClawDaemonCommand(['gateway', 'restart', '--json'], openclaw);
  if (restart.result === 'not-loaded') {
    const start = await runOpenClawDaemonCommand(['gateway', 'start', '--json'], openclaw);
    if (start.result === 'not-loaded') {
      throw new Error(buildGatewayNotLoadedMessage(start));
    }
    return {
      action: 'started',
      result: start.result ?? 'started',
      message: start.message,
      warnings: start.warnings,
    };
  }

  return {
    action: 'restarted',
    result: restart.result ?? 'restarted',
    message: restart.message,
    warnings: restart.warnings,
  };
}

export function getOpenClawBootstrapPath(stateDir = getOpenClawStateDir()): string {
  return join(stateDir, 'devices', BOOTSTRAP_FILENAME);
}

export async function issueOpenClawBootstrapToken(params: {
  deviceId: string;
  publicKey: string;
  role: string;
  scopes: readonly string[];
  stateDir?: string;
}): Promise<{ token: string; expiresAtMs: number; statePath: string }> {
  const deviceId = params.deviceId.trim();
  const publicKey = params.publicKey.trim();
  const role = params.role.trim();
  const scopes = normalizeStringArray(params.scopes);
  if (!deviceId || !publicKey || !role || scopes.length === 0) {
    throw new Error('deviceId, publicKey, role, and scopes are required');
  }

  return await withBootstrapLock(async () => {
    const stateDir = params.stateDir ?? getOpenClawStateDir();
    const statePath = getOpenClawBootstrapPath(stateDir);
    const state = await loadBootstrapState(statePath);
    const token = generatePairingToken();
    const issuedAtMs = Date.now();
    state[token] = {
      token,
      ts: issuedAtMs,
      deviceId,
      publicKey,
      roles: [role],
      scopes,
      issuedAtMs,
    };
    await writeJsonAtomic(statePath, state);
    return {
      token,
      expiresAtMs: issuedAtMs + DEVICE_BOOTSTRAP_TOKEN_TTL_MS,
      statePath,
    };
  });
}

function readConfiguredSecret(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readOpenClawConfigString(
  configPath: string,
  openclaw = resolveOpenClawPaths(),
): Promise<string | null> {
  try {
    const { stdout } = await runOpenClawCli(['config', 'get', configPath], openclaw);
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch (error) {
    if (isMissingConfigPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function readOpenClawAllowedOrigins(openclaw = resolveOpenClawPaths()): Promise<string[]> {
  try {
    const { stdout } = await runOpenClawCli(['config', 'get', 'gateway.controlUi.allowedOrigins', '--json'], openclaw);
    const parsed = parseEmbeddedJsonValue(stdout) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : [];
  } catch (error) {
    if (isMissingConfigPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function runOpenClawDaemonCommand(
  args: string[],
  openclaw = resolveOpenClawPaths(),
): Promise<{
  result?: string;
  message: string | null;
  warnings: string[];
  hints: string[];
}> {
  const { stdout } = await runOpenClawCli(args, openclaw);
  let parsed: {
    ok?: boolean;
    error?: string;
    result?: string;
    message?: string;
    warnings?: unknown;
    hints?: unknown;
  };
  try {
    parsed = parseEmbeddedJsonValue(stdout) as typeof parsed;
  } catch (error) {
    throw new Error(`OpenClaw ${args.slice(0, 2).join(' ')} returned invalid JSON output.`, { cause: error });
  }
  if (parsed.ok !== true) {
    throw new Error(parsed.error?.trim() || `OpenClaw ${args.slice(0, 2).join(' ')} failed.`);
  }
  return {
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((value): value is string => typeof value === 'string') : [],
    hints: Array.isArray(parsed.hints) ? parsed.hints.filter((value): value is string => typeof value === 'string') : [],
  };
}

async function runOpenClawCli(
  args: string[],
  openclaw = resolveOpenClawPaths(),
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
      execFile(OPENCLAW_CLI_COMMAND, args, {
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: openclaw.stateDir,
          OPENCLAW_CONFIG_PATH: openclaw.configPath,
        },
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, {
            stdout,
            stderr,
          });
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });
  } catch (error) {
    throw formatOpenClawCliError(args, error);
  }
}

function formatOpenClawCliError(args: string[], error: unknown): Error {
  const messagePrefix = `OpenClaw ${args.join(' ')}`;
  if (isExecFileError(error)) {
    if (error.code === 'ENOENT') {
      return new Error(`OpenClaw CLI was not found on PATH. Install OpenClaw and ensure \`${OPENCLAW_CLI_COMMAND}\` is available before running local pairing.`);
    }
    const combined = [error.stderr, error.stdout]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .trim();
    return new Error(combined ? `${messagePrefix} failed: ${combined}` : `${messagePrefix} failed.`);
  }
  return error instanceof Error ? error : new Error(`${messagePrefix} failed: ${String(error)}`);
}

function isMissingConfigPathError(error: unknown): boolean {
  return error instanceof Error && /Config path not found:/i.test(error.message);
}

function isExecFileError(error: unknown): error is Error & {
  code?: string | number;
  stdout?: string;
  stderr?: string;
} {
  return error instanceof Error;
}

function normalizeControlUiOrigin(origin: string): string {
  const parsed = new URL(origin.trim());
  return parsed.origin;
}

function appendUniqueOrigin(currentOrigins: string[], nextOrigin: string): string[] {
  const normalizedNext = normalizeControlUiOrigin(nextOrigin).toLowerCase();
  const seen = new Set<string>();
  const seenInvalid = new Set<string>();
  const result: string[] = [];

  for (const origin of currentOrigins) {
    const trimmed = origin.trim();
    if (!trimmed) {
      continue;
    }
    let normalized: string;
    try {
      normalized = normalizeControlUiOrigin(trimmed).toLowerCase();
    } catch {
      const invalidKey = trimmed.toLowerCase();
      if (seenInvalid.has(invalidKey)) {
        continue;
      }
      seenInvalid.add(invalidKey);
      result.push(trimmed);
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized === normalizedNext ? normalizeControlUiOrigin(nextOrigin) : normalizeControlUiOrigin(trimmed));
  }

  if (!seen.has(normalizedNext)) {
    result.push(normalizeControlUiOrigin(nextOrigin));
  }

  return result;
}

function buildGatewayNotLoadedMessage(result: {
  message: string | null;
  hints: string[];
}): string {
  const parts = [
    'OpenClaw Gateway is not running under a managed service, and no unmanaged gateway process could be restarted automatically.',
  ];
  if (result.message) {
    parts.push(result.message);
  }
  if (result.hints.length > 0) {
    parts.push(result.hints.join(' '));
  }
  parts.push('Start the Gateway first, then rerun `clawket pair --local`.');
  return parts.join(' ');
}

function parseEmbeddedJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty JSON output');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== '{' && char !== '[') {
      continue;
    }
    const candidate = extractBalancedJsonValue(trimmed, index);
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }

  throw new Error('Unable to locate a JSON value in command output.');
}

function extractBalancedJsonValue(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function readGatewayTokenEnv(): string | null {
  return readEnvValue('OPENCLAW_GATEWAY_TOKEN', 'CLAWDBOT_GATEWAY_TOKEN');
}

function readGatewayPasswordEnv(): string | null {
  return readEnvValue('OPENCLAW_GATEWAY_PASSWORD', 'CLAWDBOT_GATEWAY_PASSWORD');
}

function readEnvValue(primary: string, legacy: string): string | null {
  const current = process.env[primary]?.trim();
  if (current) return current;
  const fallback = process.env[legacy]?.trim();
  return fallback || null;
}

function resolveOpenClawPaths(): OpenClawPaths {
  const stateDir = resolveActiveOpenClawStateDir();
  const configPath = resolveActiveOpenClawConfigPath(stateDir);
  return {
    stateDir,
    configDir: dirname(configPath),
    configPath,
    mediaDir: join(stateDir, 'media'),
  };
}

function resolveActiveOpenClawStateDir(): string {
  const explicitStateDir = readEnvValue('OPENCLAW_STATE_DIR', 'CLAWDBOT_STATE_DIR');
  if (explicitStateDir) {
    return resolveUserPath(explicitStateDir);
  }

  const candidates = buildOpenClawStateDirCandidates();
  const existing = candidates.find((stateDir) => existsSync(join(stateDir, 'openclaw.json')));
  return existing ?? candidates[0] ?? join(homedir(), '.openclaw');
}

function resolveActiveOpenClawConfigPath(stateDir: string): string {
  const explicitConfigPath = readEnvValue('OPENCLAW_CONFIG_PATH', 'CLAWDBOT_CONFIG_PATH');
  if (explicitConfigPath) {
    return resolveUserPath(explicitConfigPath);
  }

  return join(stateDir, 'openclaw.json');
}

function buildOpenClawStateDirCandidates(): string[] {
  const seen = new Set<string>();
  return [homedir(), '/root']
    .map((value) => value.trim())
    .filter(Boolean)
    .map((home) => join(home, '.openclaw'))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') {
    return resolve(homedir());
  }
  if (trimmed.startsWith('~/')) {
    return resolve(join(homedir(), trimmed.slice(2)));
  }
  return resolve(trimmed);
}

async function loadBootstrapState(statePath: string): Promise<DeviceBootstrapStateFile> {
  const state = await readJsonFile<DeviceBootstrapStateFile>(statePath) ?? {};
  const now = Date.now();
  for (const [token, entry] of Object.entries(state)) {
    if (!entry || typeof entry !== 'object') {
      delete state[token];
      continue;
    }
    if (typeof entry.ts !== 'number' && typeof entry.issuedAtMs === 'number') {
      entry.ts = entry.issuedAtMs;
    }
    if (now - entry.ts > DEVICE_BOOTSTRAP_TOKEN_TTL_MS) {
      delete state[token];
    }
  }
  return state;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value, null, 2);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${randomUUIDFragment()}.tmp`;
  try {
    await writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
    await safeChmod(tmpPath, 0o600);
    await rename(tmpPath, filePath);
    await safeChmod(filePath, 0o600);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

async function safeChmod(filePath: string, mode: number): Promise<void> {
  try {
    await chmod(filePath, mode);
  } catch {
    // best-effort only
  }
}

function generatePairingToken(): string {
  return randomBytes(PAIRING_TOKEN_BYTES).toString('base64url');
}

function normalizeStringArray(values: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return [...normalized].sort();
}

function randomUUIDFragment(): string {
  return randomBytes(12).toString('hex');
}

function createAsyncLock() {
  let lock: Promise<void> = Promise.resolve();
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let release: (() => void) | undefined;
    lock = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  };
}
