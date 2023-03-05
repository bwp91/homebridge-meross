import platformConsts from '../utils/constants.js';
import { hasProperty, parseError } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic;
    this.hapErr = platform.api.hap.HapStatusError;
    this.hapServ = platform.api.hap.Service;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;
    this.lowBattThreshold = accessory.context.options.lowBattThreshold
      ? Math.min(accessory.context.options.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold;
    this.name = accessory.displayName;

    // Add the temperature service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor);
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value;
    this.updateCache();

    // Add the humidity service if it doesn't already exist
    this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor);
    this.cacheHumi = this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value;

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery);
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value;

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, { log: () => {} });

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      lowBattThreshold: this.lowBattThreshold,
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  applyUpdate(data) {
    try {
      // Temperature
      if (hasProperty(data, 'temperature')) {
        // Divide by 10 as reading is given as whole number inc decimal
        const newTemp = data.temperature / 10;
        if (newTemp !== this.cacheTemp) {
          this.cacheTemp = newTemp;
          this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp);
          this.accessory.eveService.addEntry({ temp: newTemp });
          this.accessory.log(`${platformLang.curTemp} [${newTemp}°C]`);

          // Update the cache file with the new temperature
          this.updateCache();
        }
      }

      // Humidity
      if (hasProperty(data, 'humidity')) {
        // Divide by 10 and round as reading is given as whole number inc decimal
        const newHumi = Math.round(data.humidity / 10);
        if (newHumi !== this.cacheHumi) {
          this.cacheHumi = newHumi;
          this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, newHumi);
          this.accessory.eveService.addEntry({ humidity: newHumi });
          this.accessory.log(`${platformLang.curHumi} [${newHumi}%]`);
        }
      }

      // Battery % from reported voltage
      if (hasProperty(data, 'voltage')) {
        // 1. Reduce/enlarge value so in [2000, 3000]
        let newVoltage = Math.min(Math.max(data.voltage, 2000), 3000);

        // 2. Scale this from [2000, 3000] to [0, 100] and round to nearest whole number
        newVoltage = Math.round((newVoltage - 2000) / 10);

        // This should be a rough estimate of the battery %
        if (newVoltage !== this.cacheBatt) {
          this.cacheBatt = newVoltage;
          this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt);
          this.battService.updateCharacteristic(
            this.hapChar.StatusLowBattery,
            this.cacheBatt < this.lowBattThreshold ? 1 : 0,
          );
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`);
    }
  }

  async updateCache() {
    // Don't continue if the storage client hasn't initialised properly
    if (!this.platform.storageClientData) {
      return;
    }

    // Attempt to save the new temperature to the cache
    try {
      await this.platform.storageData.setItem(
        `${this.accessory.context.subSerialNumber}_temp`,
        this.cacheTemp,
      );
    } catch (err) {
      this.accessory.logWarn(`${platformLang.storageWriteErr} ${parseError(err)}`);
    }
  }
}
