import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { stubTranslation as _ } from '@/utils/misc';
import { HttpTTSSecrets, HttpTTSSettings, loadHttpTTSSecrets } from '../httpSettings';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

export function normalizeSpeechEndpoint(
  value: string,
  apiFormat: HttpTTSSettings['apiFormat'] = 'speech',
): string {
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    const path = url.pathname.replace(/\/+$/, '');
    const route = apiFormat === 'mimo' ? 'chat/completions' : 'audio/speech';
    url.pathname = !path ? `/v1/${route}` : path.endsWith('/v1') ? `${path}/${route}` : path;
    return url.href;
  } catch {
    throw new Error(_('Enter an HTTP(S) speech URL without credentials, query or fragment'));
  }
}

export class HttpSpeechProvider implements SpeechProvider {
  readonly id = 'http-tts';
  readonly label = _('OpenAI-compatible TTS');
  readonly cacheable = false;

  constructor(
    readonly config: HttpTTSSettings,
    private readonly secrets?: HttpTTSSecrets,
  ) {}

  get fallbackVoiceId(): string {
    return `http-tts:${this.config.voice}`;
  }

  async init(): Promise<boolean> {
    try {
      normalizeSpeechEndpoint(this.config.baseUrl, this.config.apiFormat);
      return this.config.enabled && !!this.config.model.trim() && !!this.config.voice.trim();
    } catch {
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return (await this.init())
      ? [{ id: this.fallbackVoiceId, name: this.config.voice, lang: '' }]
      : [];
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!(await this.init()))
      throw new SpeechSynthesisPermanentError(_('Configure and enable HTTP TTS first'));
    const endpoint = normalizeSpeechEndpoint(this.config.baseUrl, this.config.apiFormat);
    const mimo = this.config.apiFormat === 'mimo';
    const secrets = this.secrets ?? (await loadHttpTTSSecrets(endpoint));
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) abort.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 30_000);
    try {
      if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (secrets.apiKey) headers.set('Authorization', `Bearer ${secrets.apiKey}`);
      for (const [key, value] of Object.entries(secrets.headers)) headers.set(key, value);
      // plugin-http does not forward Request.redirect to reqwest. Its explicit
      // limit is needed too, especially when custom headers contain credentials.
      const init: RequestInit & { maxRedirections: number; connectTimeout: number } = {
        method: 'POST',
        headers,
        body: JSON.stringify(
          mimo
            ? {
                model: this.config.model,
                messages: [{ role: 'assistant', content: req.text }],
                audio: { format: 'wav', voice: this.config.voice },
                stream: false,
              }
            : {
                model: this.config.model,
                voice: this.config.voice,
                input: req.text,
                response_format: 'mp3',
              },
        ),
        signal: abort.signal,
        credentials: 'omit',
        redirect: 'error',
        maxRedirections: 0,
        connectTimeout: 15_000,
      };
      const response = await getAIFetch()(endpoint, init);
      if (!response.ok) {
        await response.body?.cancel();
        const message = `${_('Speech request failed')} (HTTP ${response.status})`;
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status)
        ) {
          throw new SpeechSynthesisPermanentError(message);
        }
        throw new Error(message);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (
        contentType &&
        (mimo
          ? contentType !== 'application/json'
          : !contentType.startsWith('audio/') && contentType !== 'application/octet-stream')
      ) {
        await response.body?.cancel();
        throw new SpeechSynthesisPermanentError(_('Speech endpoint did not return binary audio'));
      }
      // A sentence response should be small. Bound streamed bytes as well as
      // elapsed time, including servers that omit Content-Length.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        abort.signal.addEventListener('abort', cancel, { once: true });
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 16 * 1024 * 1024) {
              await reader.cancel();
              throw new SpeechSynthesisPermanentError(_('Speech audio exceeds the 16 MB limit'));
            }
            chunks.push(value);
          }
          if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        } finally {
          abort.signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let audio = bytes.buffer;
      if (mimo) {
        try {
          const result = JSON.parse(new TextDecoder().decode(bytes)) as {
            choices?: { message?: { audio?: { data?: unknown } } }[];
          };
          const data = result.choices?.[0]?.message?.audio?.data;
          if (typeof data !== 'string' || !data) throw new Error();
          const decoded = atob(data);
          audio = Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer;
        } catch {
          throw new SpeechSynthesisPermanentError(_('Speech endpoint returned invalid audio'));
        }
      }
      if (!audio.byteLength)
        throw new SpeechSynthesisPermanentError(_('Speech endpoint returned empty audio'));
      // Sentence highlighting is the existing fallback; do not invent word timings.
      return { audio, boundaries: [] };
    } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (timedOut) throw new Error(_('Speech request timed out'));
      if (error instanceof SpeechSynthesisPermanentError) throw error;
      // Transport exceptions and response bodies may contain authentication data.
      throw new Error(_('Speech request failed'));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
