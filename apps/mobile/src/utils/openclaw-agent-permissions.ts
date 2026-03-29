type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function readDenyList(tools: unknown): string[] {
  if (!isRecord(tools) || !Array.isArray(tools.deny)) {
    return [];
  }
  return tools.deny
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeToolName)
    .filter(Boolean);
}

export function buildCurrentAgentCommandAccessPatch(params: {
  config: Record<string, unknown> | null;
  agentId: string;
  blocked: boolean;
}): { patch: Record<string, unknown>; changed: boolean } | null {
  const config = params.config;
  if (!config) {
    return null;
  }

  const agents = isRecord(config.agents) ? config.agents : null;
  const list = agents && Array.isArray(agents.list) ? agents.list : null;
  if (!list) {
    return null;
  }

  const currentEntry = list.find(
    (entry) => isRecord(entry) && typeof entry.id === 'string' && entry.id === params.agentId,
  );
  if (!currentEntry || !isRecord(currentEntry)) {
    return null;
  }

  const currentTools = isRecord(currentEntry.tools) ? currentEntry.tools : null;
  const currentDeny = readDenyList(currentTools);
  const currentSet = new Set(currentDeny);

  if (params.blocked) {
    currentSet.add('exec');
    currentSet.add('process');
  } else {
    currentSet.delete('exec');
    currentSet.delete('process');
  }

  const nextDeny = Array.from(currentSet);
  const changed =
    nextDeny.length !== currentDeny.length
    || nextDeny.some((entry, index) => entry !== currentDeny[index]);

  return {
    changed,
    patch: {
      agents: {
        list: [
          {
            id: params.agentId,
            tools: {
              deny: nextDeny.length > 0 ? nextDeny : null,
            },
          },
        ],
      },
    },
  };
}
