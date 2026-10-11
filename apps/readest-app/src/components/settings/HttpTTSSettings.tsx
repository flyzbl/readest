import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  DEFAULT_HTTP_TTS_SETTINGS,
  loadHttpTTSSecrets,
  parseSpeechHeaders,
  saveHttpTTSSecrets,
} from '@/services/tts/httpSettings';
import { HttpSpeechProvider, normalizeSpeechEndpoint } from '@/services/tts/providers/http';
import {
  BoxedList,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
  Tips,
} from './primitives';

const HttpTTSSettings: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [draft, setDraft] = useState(
    () => useSettingsStore.getState().settings.httpTTS ?? DEFAULT_HTTP_TTS_SETTINGS,
  );
  const [apiKey, setApiKey] = useState('');
  const [headers, setHeaders] = useState('');
  const [text, setText] = useState(_('This is a speech preview.'));
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (draft.baseUrl) {
          const secret = await loadHttpTTSSecrets(
            normalizeSpeechEndpoint(draft.baseUrl, draft.apiFormat),
          );
          if (active) {
            setApiKey(secret.apiKey);
            setHeaders(Object.keys(secret.headers).length ? JSON.stringify(secret.headers) : '');
          }
        }
      } catch {
        if (active) {
          setLoadFailed(true);
          setMessage(_('Could not load speech credentials'));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      request.current?.abort();
    };
    // Load only when the form opens. Changing the endpoint clears its credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const normalized = {
        ...draft,
        baseUrl: draft.baseUrl ? normalizeSpeechEndpoint(draft.baseUrl, draft.apiFormat) : '',
        model: draft.model.trim(),
        voice: draft.voice.trim(),
      };
      if (draft.enabled && !(await new HttpSpeechProvider(normalized).init())) {
        setMessage(_('Configure and enable HTTP TTS first'));
        return;
      }
      const secret = { apiKey: apiKey.trim(), headers: parseSpeechHeaders(headers) };
      await saveHttpTTSSecrets(normalized.baseUrl, secret);
      const store = useSettingsStore.getState();
      const next = { ...store.settings, httpTTS: normalized };
      await store.saveSettings(envConfig, next);
      store.setSettings(next);
      setDraft(normalized);
      setMessage(_('Saved. Reopen the book to apply speech settings.'));
    } catch {
      setMessage(_('Could not save speech settings. Check the URL, headers and secure storage.'));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    setMessage('');
    setAudioUrl('');
    const abort = new AbortController();
    request.current = abort;
    try {
      const provider = new HttpSpeechProvider(draft, {
        apiKey: apiKey.trim(),
        headers: parseSpeechHeaders(headers),
      });
      const result = await provider.synthesize(
        { text, voice: provider.fallbackVoiceId, lang: '', pitch: 1 },
        abort.signal,
      );
      if (!abort.signal.aborted)
        setAudioUrl(
          URL.createObjectURL(
            new Blob([result.audio], {
              type: draft.apiFormat === 'mimo' ? 'audio/wav' : 'audio/mpeg',
            }),
          ),
        );
    } catch {
      if (!abort.signal.aborted)
        setMessage(_('Speech preview failed. Check the endpoint, credentials, model and voice.'));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
      request.current = null;
    }
  };

  return (
    <div className='space-y-3' data-setting-id='settings.tts.http'>
      <BoxedList title={_('OpenAI-compatible TTS')}>
        <SettingsRow label={_('API Format')}>
          <SettingsSelect
            ariaLabel={_('API Format')}
            value={draft.apiFormat ?? 'speech'}
            disabled={busy || loading}
            options={[
              { value: 'speech', label: 'OpenAI /audio/speech' },
              { value: 'mimo', label: 'MiMo /chat/completions' },
            ]}
            onChange={(event) => {
              setDraft({
                ...draft,
                apiFormat: event.target.value as 'speech' | 'mimo',
                baseUrl: '',
              });
              setApiKey('');
              setHeaders('');
            }}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Enable')}
          checked={draft.enabled}
          disabled={busy || loading}
          onChange={() => setDraft({ ...draft, enabled: !draft.enabled })}
        />
        <SettingsRow label={_('Base URL')}>
          <SettingsInput
            aria-label={_('Base URL')}
            value={draft.baseUrl}
            disabled={busy || loading}
            placeholder='https://host/v1'
            autoCapitalize='none'
            spellCheck={false}
            onChange={(event) => {
              setDraft({ ...draft, baseUrl: event.target.value });
              setApiKey('');
              setHeaders('');
            }}
          />
        </SettingsRow>
        <SettingsRow label={_('API Key')}>
          <SettingsInput
            aria-label={_('API Key')}
            type='password'
            autoComplete='off'
            value={apiKey}
            disabled={busy || loading}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow label={_('Model')}>
          <SettingsInput
            aria-label={_('Model')}
            value={draft.model}
            disabled={busy || loading}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={_('Voice')}>
          <SettingsInput
            aria-label={_('Voice')}
            value={draft.voice}
            disabled={busy || loading}
            onChange={(event) => setDraft({ ...draft, voice: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={_('Custom Headers (JSON)')}>
          <SettingsInput
            aria-label={_('Custom Headers (JSON)')}
            type='password'
            autoComplete='off'
            value={headers}
            disabled={busy || loading}
            onChange={(event) => setHeaders(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow label={_('Preview Text')}>
          <SettingsInput
            aria-label={_('Preview Text')}
            value={text}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </SettingsRow>
      </BoxedList>
      <Tips>
        <li>
          {_(
            'MiMo mode uses /v1/chat/completions and built-in voices. Enter the base URL again after switching API format.',
          )}
        </li>
        <li>
          {_(
            'A host URL adds /v1/audio/speech; a URL ending in /v1 adds /audio/speech. Other paths are complete endpoints. No URL credentials, query or fragment.',
          )}
        </li>
        <li>
          {_(
            'Keys and headers use native secure storage, or session-only storage on Web. Changing the URL clears them. Web endpoints must allow CORS.',
          )}
        </li>
        <li>
          {_(
            'Preview sends the sample text to your endpoint and may use paid quota. Reopen the book after saving, then select the HTTP voice.',
          )}
        </li>
      </Tips>
      <div className='flex gap-2'>
        <button
          type='button'
          className='btn btn-contrast'
          disabled={busy || loading || loadFailed}
          onClick={save}
        >
          {_('Save')}
        </button>
        <button
          type='button'
          className='btn btn-ghost eink-bordered'
          disabled={busy || loading || loadFailed || !draft.enabled || !text.trim()}
          onClick={preview}
        >
          {_('Preview')}
        </button>
      </div>
      {message && (
        <p role='status' className='text-sm'>
          {message}
        </p>
      )}
      {audioUrl && (
        // The editable Preview Text above is the transcript of this generated audio.
        // biome-ignore lint/a11y/useMediaCaption: the preview transcript is already visible
        <audio controls src={audioUrl} className='w-full' aria-label={_('Speech Preview')} />
      )}
    </div>
  );
};

export default HttpTTSSettings;
