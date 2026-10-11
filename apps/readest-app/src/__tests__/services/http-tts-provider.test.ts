import { afterEach, describe, expect, test, vi } from 'vitest';
import { HttpSpeechProvider, normalizeSpeechEndpoint } from '@/services/tts/providers/http';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => h.fetch }));

const config = { enabled: true, baseUrl: 'https://tts.example/v1', model: 'model', voice: 'voice' };
const request = { text: 'Hello world', lang: 'en', voice: 'http-tts:voice', pitch: 1.2 };
const secrets = { apiKey: 'test-secret', headers: { 'X-Test': 'value' } };
const synthesize = (provider = new HttpSpeechProvider(config, secrets)) =>
  provider.synthesize(request, new AbortController().signal);

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('HTTP speech endpoint', () => {
  test('MiMo mode normalizes to chat completions', () => {
    expect(normalizeSpeechEndpoint('https://tts.example/v1', 'mimo')).toBe(
      'https://tts.example/v1/chat/completions',
    );
    expect(normalizeSpeechEndpoint('https://tts.example', 'mimo')).toBe(
      'https://tts.example/v1/chat/completions',
    );
  });
  test.each([
    ['https://tts.example', 'https://tts.example/v1/audio/speech'],
    ['https://tts.example/v1/', 'https://tts.example/v1/audio/speech'],
    ['http://localhost:8000/proxy/v1', 'http://localhost:8000/proxy/v1/audio/speech'],
    ['https://tts.example/custom/speech/', 'https://tts.example/custom/speech'],
  ])('normalizes %s', (input, expected) => expect(normalizeSpeechEndpoint(input)).toBe(expected));

  test.each([
    '',
    'file:///tmp/audio',
    'https://user:secret@tts.example',
    'https://tts.example?key=secret',
    'https://tts.example/#key',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => normalizeSpeechEndpoint(url)).toThrow();
  });
});

describe('HttpSpeechProvider', () => {
  test('MiMo uses assistant text and decodes the returned audio without word timing', async () => {
    h.fetch.mockResolvedValue(
      Response.json({ choices: [{ message: { audio: { data: 'AQID' } } }] }),
    );
    const provider = new HttpSpeechProvider({ ...config, apiFormat: 'mimo' }, secrets);
    const result = await synthesize(provider);
    expect(h.fetch.mock.calls[0]![0]).toBe('https://tts.example/v1/chat/completions');
    expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toEqual({
      model: 'model',
      messages: [{ role: 'assistant', content: 'Hello world' }],
      audio: { format: 'wav', voice: 'voice' },
      stream: false,
    });
    expect(Array.from(new Uint8Array(result.audio))).toEqual([1, 2, 3]);
    expect(result.boundaries).toEqual([]);
  });

  test('MiMo malformed responses are permanent and never echo their contents', async () => {
    const provider = new HttpSpeechProvider({ ...config, apiFormat: 'mimo' }, secrets);
    for (const data of [{}, { choices: [{ message: { audio: { data: 'invalid!!secret' } } }] }]) {
      h.fetch.mockResolvedValue(Response.json(data));
      await expect(synthesize(provider)).rejects.toThrow('Speech endpoint returned invalid audio');
    }
  });
  test('supports unauthenticated local endpoints and header-based authentication', async () => {
    h.fetch.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1]))));
    await synthesize(new HttpSpeechProvider(config, { apiKey: '', headers: {} }));
    expect(new Headers(h.fetch.mock.calls[0]![1].headers).has('authorization')).toBe(false);
    await synthesize(
      new HttpSpeechProvider(config, { apiKey: '', headers: { 'api-key': 'custom-secret' } }),
    );
    expect(new Headers(h.fetch.mock.calls[1]![1].headers).get('api-key')).toBe('custom-secret');
    expect(new HttpSpeechProvider(config).cacheable).toBe(false);
  });

  test('posts binary speech with no rate or fabricated boundaries', async () => {
    h.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    const result = await synthesize();
    expect(result.boundaries).toEqual([]);
    expect(result.audio.byteLength).toBe(3);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe('https://tts.example/v1/audio/speech');
    expect(JSON.parse(init.body)).toEqual({
      model: 'model',
      voice: 'voice',
      input: 'Hello world',
      response_format: 'mp3',
    });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-secret');
    expect(new Headers(init.headers).get('X-Test')).toBe('value');
    expect(init.redirect).toBe('error');
    expect(init.maxRedirections).toBe(0);
    expect(init.credentials).toBe('omit');
  });

  test('disabled and incomplete providers make no requests', async () => {
    for (const change of [{ enabled: false }, { model: '' }, { voice: '' }, { baseUrl: '' }]) {
      const provider = new HttpSpeechProvider({ ...config, ...change }, secrets);
      expect(await provider.init()).toBe(false);
      await expect(synthesize(provider)).rejects.toThrow();
    }
    expect(h.fetch).not.toHaveBeenCalled();
  });

  test('does not expose server errors or transport credentials', async () => {
    h.fetch.mockResolvedValueOnce(new Response('test-secret', { status: 401 }));
    await expect(synthesize()).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    h.fetch.mockRejectedValueOnce(new Error('test-secret'));
    await expect(synthesize()).rejects.toThrow('Speech request failed');
  });

  test('rejects JSON and empty audio responses', async () => {
    h.fetch.mockResolvedValueOnce(
      new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(synthesize()).rejects.toThrow();
    h.fetch.mockResolvedValueOnce(new Response(new Uint8Array()));
    await expect(synthesize()).rejects.toThrow();
  });

  test('honors cancellation without sending a request', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      new HttpSpeechProvider(config, secrets).synthesize(request, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  test('bounds stalled requests', async () => {
    vi.useFakeTimers();
    h.fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const result = expect(synthesize()).rejects.toThrow('Speech request timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
  });

  test('bounds stalled response bodies and releases their stream', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    h.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = expect(synthesize()).rejects.toThrow('Speech request timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(cancel).toHaveBeenCalled();
  });

  test('rejects oversized streams even without Content-Length', async () => {
    h.fetch.mockResolvedValue(new Response(new Uint8Array(16 * 1024 * 1024 + 1)));
    await expect(synthesize()).rejects.toThrow('Speech audio exceeds the 16 MB limit');
  });

  test('cancels an in-flight request', async () => {
    const abort = new AbortController();
    h.fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('transport detail')));
        }),
    );
    const result = expect(
      new HttpSpeechProvider(config, secrets).synthesize(request, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalled());
    abort.abort();
    await result;
  });
});
