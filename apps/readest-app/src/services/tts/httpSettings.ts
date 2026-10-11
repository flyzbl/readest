import { isTauriAppPlatform } from '@/services/environment';
import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { stubTranslation as _ } from '@/utils/misc';

export interface HttpTTSSettings {
  enabled: boolean;
  apiFormat?: 'speech' | 'mimo';
  baseUrl: string;
  model: string;
  voice: string;
}

export interface HttpTTSSecrets {
  apiKey: string;
  headers: Record<string, string>;
}

export const DEFAULT_HTTP_TTS_SETTINGS: HttpTTSSettings = {
  enabled: false,
  baseUrl: '',
  model: '',
  voice: '',
};

const SECRET_KEY = 'readest.http-tts.credentials.v1';

export function parseSpeechHeaders(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const headers: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      const name = key.toLowerCase();
      if (
        typeof entry !== 'string' ||
        /[\r\n]/.test(entry) ||
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) ||
        /^(host|cookie|cookie2|origin|referer|content-length|content-type|connection|transfer-encoding|upgrade|trailer|te|expect|accept-encoding)$/.test(
          name,
        ) ||
        name.startsWith('sec-') ||
        name.startsWith('proxy-')
      )
        throw new Error();
      headers[name] = entry;
    }
    return headers;
  } catch {
    throw new Error(_('Custom headers must be a JSON object of HTTP header strings'));
  }
}

// Credentials are endpoint-bound and never enter SystemSettings, sync, or backups.
export async function loadHttpTTSSecrets(endpoint: string): Promise<HttpTTSSecrets> {
  try {
    const result = isTauriAppPlatform()
      ? await getSecureItem({ key: SECRET_KEY })
      : { value: sessionStorage.getItem(SECRET_KEY) };
    if ('error' in result && result.error) throw new Error();
    if (result.value) {
      const stored = JSON.parse(result.value);
      if (stored.endpoint === endpoint && typeof stored.apiKey === 'string') {
        return {
          apiKey: stored.apiKey,
          headers: parseSpeechHeaders(JSON.stringify(stored.headers)),
        };
      }
    }
    return { apiKey: '', headers: {} };
  } catch {
    throw new Error(_('Could not load speech credentials'));
  }
}

export async function saveHttpTTSSecrets(endpoint: string, secrets: HttpTTSSecrets): Promise<void> {
  try {
    const empty = !secrets.apiKey && Object.keys(secrets.headers).length === 0;
    const value = JSON.stringify({ endpoint, ...secrets });
    if (isTauriAppPlatform()) {
      const result = empty
        ? await clearSecureItem({ key: SECRET_KEY })
        : await setSecureItem({ key: SECRET_KEY, value });
      if (!result.success) throw new Error();
    } else if (empty) {
      sessionStorage.removeItem(SECRET_KEY);
    } else {
      sessionStorage.setItem(SECRET_KEY, value);
    }
  } catch {
    throw new Error(_('Could not save speech credentials'));
  }
}
