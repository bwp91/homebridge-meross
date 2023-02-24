import PQueue from 'p-queue'; // eslint-disable-line import/no-unresolved
import { TimeoutError } from 'p-timeout';
import platformConsts from '../utils/constants.js';
import { hasProperty, parseError } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory, priAcc) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar;
    this.hapChar = platform.api.hap.Characteristic;
    this.hapErr = platform.api.hap.HapStatusError;
    this.hapServ = platform.api.hap.Service;
    this.log = platform.log;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;
    this.lowBattThreshold = accessory.context.options.lowBattThreshold
      ? Math.min(accessory.context.options.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold;
    this.name = accessory.displayName;
    this.priAcc = priAcc;

    this.mode2Label = {
      0: 'manual',
      1: 'heat',
      2: 'cool',
      3: 'auto',
      4: 'economy',
    };
    this.mode2Char = {
      0: false,
      1: this.cusChar.ValveHeatMode,
      2: this.cusChar.ValveCoolMode,
      3: this.cusChar.ValveAutoMode,
      4: this.cusChar.ValveEconomyMode,
    };

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat);

    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onSet(async (value) => this.internalStateUpdate(value));
    this.cacheState = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value;

    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .setProps({
        minValue: 5,
        maxValue: 35,
        minStep: 0.5,
      })
      .onSet(async (value) => this.internalTargetUpdate(value));
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.TargetTemperature).value;

    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value;
    this.updateCache();

    if (!this.service.testCharacteristic(this.cusChar.ValveHeatMode)) {
      this.service.addCharacteristic(this.cusChar.ValveHeatMode);
    }
    this.service
      .getCharacteristic(this.cusChar.ValveHeatMode)
      .onSet(async (value) => this.internalModeUpdate(value, 1));
    if (!this.service.testCharacteristic(this.cusChar.ValveCoolMode)) {
      this.service.addCharacteristic(this.cusChar.ValveCoolMode);
    }
    this.service
      .getCharacteristic(this.cusChar.ValveCoolMode)
      .onSet(async (value) => this.internalModeUpdate(value, 2));
    if (!this.service.testCharacteristic(this.cusChar.ValveAutoMode)) {
      this.service.addCharacteristic(this.cusChar.ValveAutoMode);
    }
    this.service
      .getCharacteristic(this.cusChar.ValveAutoMode)
      .onSet(async (value) => this.internalModeUpdate(value, 3));
    if (!this.service.testCharacteristic(this.cusChar.ValveEconomyMode)) {
      this.service.addCharacteristic(this.cusChar.ValveEconomyMode);
    }
    this.cacheMode = 0;
    this.service
      .getCharacteristic(this.cusChar.ValveEconomyMode)
      .onSet(async (value) => this.internalModeUpdate(value, 4));
    if (!this.service.testCharacteristic(this.cusChar.ValveWindowOpen)) {
      this.service.addCharacteristic(this.cusChar.ValveWindowOpen);
    }
    this.cacheWindow = this.service.getCharacteristic(this.cusChar.ValveWindowOpen).value;

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, { log: () => {} });

    // Create the queue used for sending device requests
    this.updateInProgress = false;
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true,
    });
    this.queue.on('idle', () => {
      this.updateInProgress = false;
    });

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      lowBattThreshold: this.lowBattThreshold,
    });
    this.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  async internalStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload and namespace
        const namespace = 'Appliance.Hub.ToggleX';
        const payload = {
          togglex: [
            {
              id: this.accessory.context.subSerialNumber,
              onoff: value,
            },
          ],
        };

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.priAcc, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.cacheState = value;

        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`);
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, this.cacheState);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalModeUpdate(value, newMode) {
    try {
      // If turning off then set to manual mode
      if (!value) {
        newMode = 0;
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (newMode === this.cacheMode) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload and namespace
        const namespace = 'Appliance.Hub.Mts100.Mode';
        const payload = {
          mode: [
            {
              id: this.accessory.context.subSerialNumber,
              state: newMode,
            },
          ],
        };

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.priAcc, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.cacheState = value;
        this.accessory.log(`${platformLang.curMode} [${this.mode2Label[newMode]}]`);

        // Turn the other modes off
        Object.entries(this.mode2Char).forEach((entry) => {
          const [mode, char] = entry;
          if (char && mode !== newMode.toString()) {
            this.service.updateCharacteristic(char, false);
          }
        });
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.mode2Char[newMode], false);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalTargetUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheTarg) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload and namespace
        const namespace = 'Appliance.Hub.Mts100.Temperature';
        const payload = {
          temperature: [
            {
              custom: value * 10,
              id: this.accessory.context.subSerialNumber,
            },
          ],
        };

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.priAcc, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.cacheTarg = value;
        this.accessory.log(`${platformLang.curTarg} [${value}°C]`);

        // Update the current heating state
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeatingCoolingState,
          value > this.cacheTemp ? 1 : 0,
        );

        // Turn the modes off as back to manual mode
        Object.values(this.mode2Char).forEach((char) => {
          if (char) {
            this.service.updateCharacteristic(char, false);
          }
        });
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  applyUpdate(data) {
    try {
      let needsUpdate = false;
      if (hasProperty(data, 'state')) {
        const newState = data.state;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState);
          this.cacheState = newState;
          this.accessory.log(`${platformLang.curState} [${newState === 1 ? 'on' : 'off'}]`);
          needsUpdate = true;
        }
      }
      if (hasProperty(data, 'targTemperature')) {
        const newTarg = data.targTemperature;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTarg !== newTarg) {
          this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg);
          this.cacheTarg = newTarg;
          this.accessory.log(`${platformLang.curTarg} [${newTarg}°C]`);
          needsUpdate = true;
        }
      }
      if (hasProperty(data, 'currTemperature')) {
        const newTemp = data.currTemperature;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTemp !== newTemp) {
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp);
          this.cacheTemp = newTemp;
          this.accessory.eveService.addEntry({ temp: newTemp });
          this.accessory.log(`${platformLang.curTemp} [${newTemp}°C]`);
          needsUpdate = true;

          // Update the cache file with the new temperature
          this.updateCache();
        }
      }

      // Update the current heating state
      if (needsUpdate) {
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeatingCoolingState,
          this.cacheState === 1 && this.cacheTarg > this.cacheTemp ? 1 : 0,
        );
      }

      // Todo - data.openWindow and data.mode
      if (hasProperty(data, 'openWindow')) {
        const newWindow = data.openWindow === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheWindow !== newWindow) {
          this.service.updateCharacteristic(this.cusChar.ValveWindowOpen, newWindow);
          this.cacheWindow = newWindow;
          this.accessory.log(`${platformLang.curWindow} [${newWindow ? 'open' : 'closed'}]`);
        }
      }

      if (hasProperty(data, 'mode')) {
        const newMode = data.mode;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheMode !== newMode) {
          Object.entries(this.mode2Char).forEach((entry) => {
            const [mode, char] = entry;
            if (char) {
              this.service.updateCharacteristic(char, mode === newMode.toString());
            }
          });
          this.cacheMode = newMode;
          this.accessory.log(`${platformLang.curMode} [${this.mode2Label[newMode]}]`);
        }
      }
    } catch (err) {
      const eText = parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.refFailed, eText);
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
