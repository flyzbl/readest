# Personal self-host build and HTTP speech

This fork keeps Readest's upstream entitlement path but enables it by default for
fork builds: `NEXT_PUBLIC_SELF_HOSTED=true` is tracked in both `.env.tauri` and
`.env.web`. Docker/self-host deployments can still use the server-side
`SELF_HOSTED=true` runtime flag. No subscription claims, quota checks, or payment
gates are patched; the fork simply builds in the upstream-supported self-hosted
mode.

This enables the client features already covered by `isCustomizationAllowed`,
including full customization, custom translators, third-party cloud sync
(WebDAV / Google Drive / S3 / OneDrive), Offline Read Aloud downloads,
Audiobookshelf offline downloads and Nearby BookDrop pairing. It does not grant
Readest Cloud storage, hosted AI/translation credits, personal email-in service,
or any other Readest-hosted infrastructure whose capacity is provided by their
servers. Use your own backend/keys for those services. The new speech provider
sends requests directly to the endpoint you configure; it never uses Readest's
API proxy or account token.

## Configuration

Open Settings → Read Aloud → OpenAI-compatible TTS. Enable the provider, enter
the URL, model and voice supported by your backend, then Save. Reopen the book
to apply changes to an existing read-aloud session, and choose the voice in the
OpenAI-compatible TTS group. Existing default engine selection is preserved.

URL normalization:

- `https://host` → `https://host/v1/audio/speech`
- `https://host/prefix/v1/` → `https://host/prefix/v1/audio/speech`
- Any other non-root path is a complete endpoint, preserved apart from trailing
  slashes (including `/v1/audio/speech`).
- Only HTTP(S) is accepted. URL userinfo, query parameters and fragments are
  rejected; use the API Key or custom headers for authentication. Prefer HTTPS
  outside a trusted local network. Redirects are rejected.

API Key sends `Authorization: Bearer …`. Optional custom headers are a JSON
object of string values, such as `{"api-key":"…"}` for a service using that
authentication scheme. Custom headers override the generated Authorization
header if supplied. Transport/cookie headers cannot be overridden. Content-Type
is always JSON. Model and voice names are passed verbatim.

### Direct MiMo mode

MiMo's official TTS uses Chat Completions rather than the binary Speech API.
Select **MiMo /chat/completions**, then enter the base URL again. In this mode
a host adds `/v1/chat/completions`, and a `/v1` URL adds `/chat/completions`.
Other complete endpoint paths are preserved. Switching formats clears the URL
and credentials to avoid silently sending authentication to the wrong endpoint.

Example: base URL `https://api.xiaomimimo.com/v1`, model `mimo-v2.5-tts`, voice
`mimo_default` (or a supported built-in voice such as `冰糖` or `Mia`). Supply
your own MiMo key. This mode puts the text in an assistant message, requests
non-streaming WAV audio, and decodes `choices[0].message.audio.data`. It supports
built-in voices, not voice design or voice cloning. Protocol checked against
[MiMo's official synthesis guide](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)
on 2026-10-11; live paid requests were not made.

Preview sends the entered sample text with the current form values, including
unsaved values, to that endpoint. It may consume the backend's paid quota.
Playback uses the existing Readest buffered player. In Speech API mode requests contain `model`,
`voice`, `input` and `response_format: "mp3"`; no playback rate or pitch is sent.
The Speech API backend must return binary audio, not JSON/base64 or an SSE stream.
Only the explicit MiMo mode accepts a JSON/base64 audio response.

## Credentials and limits

Keys and custom headers are stored separately from settings, in the existing
native secure-item bridge (Android EncryptedSharedPreferences backed by Keystore;
platform keychain on desktop/iOS). On Web they are kept in sessionStorage and
must be re-entered in a new browser session. They are bound to the exact
normalized endpoint and are not synced or included in settings backups. There
is no plaintext fallback when the native secure store fails. Clear both secret
fields and Save to remove the saved credentials.

Web requires the endpoint to allow CORS; HTTPS pages cannot call HTTP endpoints
in browsers that block mixed content. Native builds use the existing Tauri HTTP
transport, including Android. No new native permissions are needed.

Synthesis has a 30-second deadline and a 16 MB response limit per request (including
the JSON/base64 envelope in MiMo mode); the existing buffered client
owns its bounded retry policy. Error messages omit response bodies, credentials,
URLs and transport exception details. Providers returning no word boundaries
use sentence highlighting. No synthetic word timing is produced. This provider
does not opt into persistent audio caching or chapter downloads; those existing
controls continue to use Edge. There is one configurable HTTP provider/voice.

## Patch map

Paths below are relative to `apps/readest-app/`:

- `src/services/tts/providers/http.ts`: endpoint normalization, direct HTTP
  synthesis, cancellation, response limits and sanitized failures.
- `src/services/tts/httpSettings.ts`: configuration types and endpoint-bound
  native/session credential storage.
- `src/services/tts/HttpTTSClient.ts`: buffered player adapter, language-independent
  voice selection and sentence-only highlighting capability.
- `src/services/tts/TTSController.ts`: registration, selection, gaps and shutdown.
- `src/services/tts/BufferedTTSClient.ts`, `src/services/tts/gap.ts`,
  `src/services/constants.ts`: relocate unchanged pause constants to remove
  controller/client import cycles; keep the old exports available.
- `src/types/settings.ts`: optional, device-local, non-secret configuration.
- `src/components/settings/HttpTTSSettings.tsx`,
  `src/components/settings/TTSPanel.tsx`: configuration and audio preview.
- `public/locales/zh-CN/translation.json`: Simplified Chinese labels; other
  untranslated locales use the existing English-key fallback.
- `src/__tests__/services/http-tts-provider.test.ts`,
  `src/__tests__/services/http-tts-settings.test.ts`,
  `src/__tests__/services/tts-controller.test.ts`,
  `src/__tests__/components/settings/HttpTTSSettings.test.tsx`,
  `src/__tests__/components/settings/TTSPanel.test.tsx`,
  `src/__tests__/utils/customization-access.test.ts`: transport, secrets, settings,
  engine selection and upstream self-host entitlement regression coverage.
- `.env.selfhost.example` and this document: self-host build and usage instructions.

The local `.env.local` is intentionally ignored by git. No reading renderer,
native implementation, subscription gate or cloud quota implementation is patched.

## Verification on 2026-10-11

- `pnpm lint`: passed (TypeScript and Biome, 2,704 files).
- Final TTS regression collection (`vitest run --maxWorkers=2 tts edge-tts
  native-tts web-speech customization-access`, from the app directory):
  82 files passed, one skipped; 1,214 tests passed, nine skipped. This includes
  Edge, native, WebSpeech, HTTP/MiMo, player/controller and PDF speech coverage.
- Focused HTTP/MiMo provider, credentials, settings, controller, self-host and PDF
  tests: 214 passed. Requests used mocks; no live API keys or paid synthesis.
- Full unit suite: attempted with two workers. The first complete attempt reached
  its 600-second deadline; after fixing missing PDF vendor assets, a verbose run
  with a 1,200-second bound was interrupted by SIGTERM without a final summary.
  Its log recorded 10,568 passing tests and three MiMo test-first failures that
  passed in the subsequent focused run. The full suite is **not certified green**.
- Android `tauri android build --target aarch64 --debug`: could not start Rust
  compilation because `cargo` is absent. No APK was produced. Java/Android NDK
  were also absent from the checked standard installation locations.
- Native-device audio, OS secure storage and real endpoint behavior still need
  device verification. In particular, MiMo WAV playback on iOS uses the existing
  native player and was not exercised here.
