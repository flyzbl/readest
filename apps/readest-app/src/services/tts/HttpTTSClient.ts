import type { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { HttpTTSSettings } from './httpSettings';
import { HttpSpeechProvider } from './providers/http';
import type { TTSController } from './TTSController';

export class HttpTTSClient extends BufferedTTSClient {
  constructor(config: HttpTTSSettings, controller?: TTSController, appService?: AppService | null) {
    super(new HttpSpeechProvider(config), controller, appService);
  }

  override getCapabilities() {
    return { ...super.getCapabilities(), wordBoundaries: false };
  }

  // A user-supplied voice has no language catalog. Make it selectable for every
  // book language without pretending that the backend supports that language.
  override async getVoices(lang: string) {
    return [
      {
        id: this.name,
        name: this.provider.label,
        voices: (await this.getAllVoices()).map((voice) => ({ ...voice, lang })),
        disabled: !this.initialized,
      },
    ];
  }
}
