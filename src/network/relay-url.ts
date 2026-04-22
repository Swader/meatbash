type RelayLocation = Pick<Location, 'hostname' | 'origin' | 'port' | 'protocol'>;

function isLocalDevHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  return lowerHost === 'localhost' ||
    lowerHost === '127.0.0.1' ||
    lowerHost === '0.0.0.0' ||
    lowerHost === '[::1]' ||
    lowerHost.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}\.(nip\.io|sslip\.io)$/.test(lowerHost);
}

export function resolveRelayUrl(
  location: RelayLocation,
  override: string | null | undefined
): string {
  const trimmedOverride = typeof override === 'string' ? override.trim() : '';
  if (trimmedOverride) return trimmedOverride;

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname || 'localhost';
  if (!isLocalDevHost(host)) {
    const relayUrl = new URL(location.origin);
    relayUrl.protocol = wsProtocol;
    relayUrl.pathname = '/ws';
    relayUrl.search = '';
    relayUrl.hash = '';
    return relayUrl.toString();
  }

  const rawPort = Number.parseInt(location.port, 10);
  const port = Number.isFinite(rawPort) ? rawPort + 1 : 3001;
  return `${wsProtocol}//${host}:${port}/ws`;
}
