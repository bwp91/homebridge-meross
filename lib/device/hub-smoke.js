import platformConsts from '../utils/constants.js';
import { parseError } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic;
    this.hapErr = platform.api.hap.HapStatusError;
    this.hapServ = platform.api.hap.Service;
    this.log = platform.log;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;
    this.enableLogging = accessory.context.enableLogging;
    this.enableDebugLogging = accessory.context.enableDebugLogging;
    this.lowBattThreshold = accessory.context.options.lowBattThreshold
      ? Math.min(accessory.context.options.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold;
    this.name = accessory.displayName;

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery);
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value;

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable';
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
      lowBattThreshold: this.lowBattThreshold,
    });
    this.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  applyUpdate(data) {
    try {
      this.log.warn('[%s]\n%s.', this.name, JSON.stringify(data));
    } catch (err) {
      const eText = parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.refFailed, eText);
    }
  }
}
