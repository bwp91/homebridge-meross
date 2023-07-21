import { parseError } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar;
    this.hapChar = platform.api.hap.Characteristic;
    this.hapErr = platform.api.hap.HapStatusError;
    this.hapServ = platform.api.hap.Service;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;

    // Battery service is not available with this device, so remove the service if exists
    if (this.accessory.getService(this.hapServ.Battery)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Battery));
    }

    // Add the leak sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.LeakSensor);
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.LeakSensor);
      this.service.addCharacteristic(this.eveChar.LastActivation);
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('motion', this.accessory, { log: () => {} });

    // Reset to no leak when homebridge starts
    this.service.updateCharacteristic(this.hapChar.LeakDetected, 0);
    this.accessory.eveService.addEntry({ status: 0 });
    this.cacheLeak = 0;

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
    });
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts);
  }

  applyUpdate(data) {
    try {
      if (data.waterLeak) {
        switch (data.waterLeak.latestWaterLeak) {
          case 1: {
            // Leak detected
            if (this.cacheLeak !== 1) {
              this.service.updateCharacteristic(this.hapChar.LeakDetected, 1);
              this.accessory.eveService.addEntry({ status: 1 });
              this.cacheLeak = 1;
            }
            break;
          }
          case 0: {
            // No leak detected
            if (this.cacheLeak !== 0) {
              this.service.updateCharacteristic(this.hapChar.LeakDetected, 0);
              this.accessory.eveService.addEntry({ status: 0 });
              this.cacheLeak = 0;
            }
            break;
          }
          default: {
            // Unknown status if possible
            this.accessory.logWarn(`unknown latestWaterLeak status received: ${JSON.stringify(data.waterLeak)}`);
            break;
          }
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`);
    }
  }
}