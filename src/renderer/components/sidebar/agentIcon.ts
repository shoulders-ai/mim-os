const AGENT_ICONS: Record<string, string> = {
  'claude-code': '/agents/claude-code.svg',
  'codex': '/agents/codex.svg',
  'gemini-cli': '/agents/gemini-cli.svg',
}

export function agentIconUrl(agentId: string): string | null {
  return AGENT_ICONS[agentId] ?? null
}
