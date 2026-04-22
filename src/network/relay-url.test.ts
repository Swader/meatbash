import { describe, expect, test } from 'bun:test';
import { resolveRelayUrl } from './relay-url';

describe('resolveRelayUrl', () => {
  test('uses override when provided', () => {
    expect(resolveRelayUrl({
      hostname: 'meatbash.bitfalls.com',
      origin: 'https://meatbash.bitfalls.com',
      port: '',
      protocol: 'https:',
    }, '  wss://relay.example/ws  ')).toBe('wss://relay.example/ws');
  });

  test('uses same host with wss on deployed https origins', () => {
    expect(resolveRelayUrl({
      hostname: 'meatbash.bitfalls.com',
      origin: 'https://meatbash.bitfalls.com',
      port: '',
      protocol: 'https:',
    }, '')).toBe('wss://meatbash.bitfalls.com/ws');
  });

  test('preserves explicit non-local ports on deployed origins', () => {
    expect(resolveRelayUrl({
      hostname: 'example.com',
      origin: 'http://example.com:8080',
      port: '8080',
      protocol: 'http:',
    }, '')).toBe('ws://example.com:8080/ws');
  });

  test('maps localhost app port to the relay port', () => {
    expect(resolveRelayUrl({
      hostname: 'localhost',
      origin: 'http://localhost:3000',
      port: '3000',
      protocol: 'http:',
    }, '')).toBe('ws://localhost:3001/ws');
  });

  test('treats sslip local aliases as local dev hosts', () => {
    expect(resolveRelayUrl({
      hostname: '127.0.0.1.sslip.io',
      origin: 'https://127.0.0.1.sslip.io:4443',
      port: '4443',
      protocol: 'https:',
    }, '')).toBe('wss://127.0.0.1.sslip.io:4444/ws');
  });
});
