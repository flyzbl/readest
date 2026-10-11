import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  settings: {
    httpTTS: { enabled: true, baseUrl: 'https://tts.example/v1', model: 'model', voice: 'voice' },
  },
  saveSettings: vi.fn(),
  setSettings: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: h.settings,
      saveSettings: h.saveSettings,
      setSettings: h.setSettings,
    }),
  },
}));
vi.mock('@/services/tts/httpSettings', async (original) => ({
  ...(await original<typeof import('@/services/tts/httpSettings')>()),
  loadHttpTTSSecrets: h.load,
  saveHttpTTSSecrets: h.save,
}));

import HttpTTSSettings from '@/components/settings/HttpTTSSettings';

beforeEach(() => {
  vi.clearAllMocks();
  h.load.mockResolvedValue({ apiKey: 'test-secret', headers: { 'api-key': 'header-secret' } });
  h.save.mockResolvedValue(undefined);
  h.saveSettings.mockResolvedValue(undefined);
});
afterEach(cleanup);

test('saves credentials separately from ordinary settings', async () => {
  render(<HttpTTSSettings />);
  await waitFor(() =>
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('test-secret'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.saveSettings).toHaveBeenCalled());
  expect(h.save).toHaveBeenCalledWith('https://tts.example/v1/audio/speech', {
    apiKey: 'test-secret',
    headers: { 'api-key': 'header-secret' },
  });
  expect(JSON.stringify(h.saveSettings.mock.calls)).not.toContain('secret');
  expect(h.setSettings).toHaveBeenCalled();
});

test('changing endpoint clears both authentication fields', async () => {
  render(<HttpTTSSettings />);
  await waitFor(() =>
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('test-secret'),
  );
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://other.example/v1' },
  });
  expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Custom Headers (JSON)') as HTMLInputElement).value).toBe('');
});

test('switching protocol clears the old endpoint and credentials', async () => {
  render(<HttpTTSSettings />);
  await waitFor(() =>
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('test-secret'),
  );
  fireEvent.change(screen.getByLabelText('API Format'), { target: { value: 'mimo' } });
  expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://tts.example/v1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.saveSettings).toHaveBeenCalled());
  expect(h.saveSettings.mock.calls[0]![1].httpTTS).toMatchObject({
    apiFormat: 'mimo',
    baseUrl: 'https://tts.example/v1/chat/completions',
  });
});

test('a secure-store failure does not save or enable ordinary settings', async () => {
  h.save.mockRejectedValue(new Error('secret detail'));
  render(<HttpTTSSettings />);
  await waitFor(() =>
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('test-secret'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('status');
  expect(h.saveSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).not.toContain('secret detail');
});

test('a failed credential load cannot overwrite stored secrets with empty fields', async () => {
  h.load.mockRejectedValue(new Error('secret detail'));
  render(<HttpTTSSettings />);
  await screen.findByRole('status');
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole('status').textContent).not.toContain('secret detail');
});
