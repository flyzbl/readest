import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  loadHttpTTSSecrets,
  saveHttpTTSSecrets,
  parseSpeechHeaders,
} from '@/services/tts/httpSettings';

const h = vi.hoisted(() => ({ native: false, get: vi.fn(), set: vi.fn(), clear: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => h.native }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: h.get,
  setSecureItem: h.set,
  clearSecureItem: h.clear,
}));
const endpoint = 'https://tts.example/v1/audio/speech';
const secrets = { apiKey: 'test-secret', headers: { 'api-key': 'test-header-secret' } };
afterEach(() => {
  h.native = false;
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('HTTP TTS credentials', () => {
  test('web credentials are session-only and bound to the exact endpoint', async () => {
    await saveHttpTTSSecrets(endpoint, secrets);
    expect(await loadHttpTTSSecrets(endpoint)).toEqual(secrets);
    expect(await loadHttpTTSSecrets('https://other.example/v1/audio/speech')).toEqual({
      apiKey: '',
      headers: {},
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('test-secret');
  });

  test('native credentials use the keyed secure bridge', async () => {
    h.native = true;
    h.set.mockResolvedValue({ success: true });
    await saveHttpTTSSecrets(endpoint, secrets);
    const stored = h.set.mock.calls[0]![0];
    h.get.mockResolvedValue({ value: stored.value });
    expect(await loadHttpTTSSecrets(endpoint)).toEqual(secrets);
    expect(sessionStorage.length).toBe(0);
  });

  test('storage failures surface without exposing bridge messages or falling back', async () => {
    h.native = true;
    h.set.mockResolvedValue({ success: false, error: 'test-secret' });
    await expect(saveHttpTTSSecrets(endpoint, secrets)).rejects.toThrow(
      'Could not save speech credentials',
    );
    expect(sessionStorage.length).toBe(0);
  });

  test('blank credentials delete the native slot', async () => {
    h.native = true;
    h.clear.mockResolvedValue({ success: true });
    await saveHttpTTSSecrets(endpoint, { apiKey: '', headers: {} });
    expect(h.clear).toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });
});

test('headers accept string maps and reject transport overrides and newlines', () => {
  expect(parseSpeechHeaders('{"api-key":"value"}')).toEqual({ 'api-key': 'value' });
  for (const value of [
    '[]',
    'null',
    '{"x":2}',
    '{"Host":"other"}',
    '{"Cookie":"session"}',
    '{"x":"a\\nb"}',
  ]) {
    expect(() => parseSpeechHeaders(value)).toThrow();
  }
});
