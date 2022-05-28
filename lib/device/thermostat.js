import PQueue from 'p-queue'; // eslint-disable-line import/no-unresolved
import { TimeoutError } from 'p-timeout';
import mqttClient from '../connection/mqtt.js';
import platformConsts from '../utils/constants.js';
import platformFuncs from '../utils/functions.js';
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
    // this.enableLogging = accessory.context.enableLogging
    // this.enableDebugLogging = accessory.context.enableDebugLogging
    this.enableLogging = true;
    this.enableDebugLogging = true;
    this.name = accessory.displayName;
    const cloudRefreshRate = platformFuncs.hasProperty(platform.config, 'cloudRefreshRate')
      ? platform.config.cloudRefreshRate
      : platformConsts.defaultValues.cloudRefreshRate;
    const localRefreshRate = platformFuncs.hasProperty(platform.config, 'refreshRate')
      ? platform.config.refreshRate
      : platformConsts.defaultValues.refreshRate;
    this.pollInterval = accessory.context.connection === 'local'
      ? localRefreshRate
      : cloudRefreshRate;

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
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {},
    });

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

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new mqttClient(platform, this.accessory);
      this.accessory.mqtt.connect();
    }

    // Always request a device update on startup, then start the interval for polling
    this.requestUpdate(true);
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    );

    // Output the customised options to the log
    const normalLogging = this.enableLogging ? 'standard' : 'disable';
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
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
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.cacheState = value;
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off');
        }
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : platformFuncs.parseError(err);
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
        if (this.enableLogging) {
          this.log('[%s] current mode [%s].', this.name, this.mode2Label[newMode]);
        }

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
      const eText = err instanceof TimeoutError ? platformLang.timeout : platformFuncs.parseError(err);
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
        if (this.enableLogging) {
          this.log('[%s] current target [%s°C].', this.name, value);
        }

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
      const eText = err instanceof TimeoutError ? platformLang.timeout : platformFuncs.parseError(err);
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
      if (platformFuncs.hasProperty(data, 'state')) {
        const newState = data.state;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState);
          this.cacheState = newState;
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, newState === 1 ? 'on' : 'off');
          }
          needsUpdate = true;
        }
      }
      if (platformFuncs.hasProperty(data, 'targTemperature')) {
        const newTarg = data.targTemperature;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTarg !== newTarg) {
          this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg);
          this.cacheTarg = newTarg;
          if (this.enableLogging) {
            this.log('[%s] current target [%s°C].', this.name, newTarg);
          }
          needsUpdate = true;
        }
      }
      if (platformFuncs.hasProperty(data, 'currTemperature')) {
        const newTemp = data.currTemperature;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTemp !== newTemp) {
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp);
          this.cacheTemp = newTemp;
          this.accessory.eveService.addEntry({ temp: newTemp });
          if (this.enableLogging) {
            this.log('[%s] current temperature [%s°C].', this.name, newTemp);
          }
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
      if (platformFuncs.hasProperty(data, 'openWindow')) {
        const newWindow = data.openWindow === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheWindow !== newWindow) {
          this.service.updateCharacteristic(this.cusChar.ValveWindowOpen, newWindow);
          this.cacheWindow = newWindow;
          if (this.enableLogging) {
            this.log('[%s] current window open [%s].', this.name, newWindow ? 'yes' : 'no');
          }
        }
      }

      if (platformFuncs.hasProperty(data, 'mode')) {
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
          if (this.enableLogging) {
            this.log('[%s] current mode [%s].', this.name, this.mode2Label[newMode]);
          }
        }
      }
    } catch (err) {
      const eText = platformFuncs.parseError(err);
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
        `${this.accessory.context.serialNumber}_temp`,
        this.cacheTemp,
      );
    } catch (err) {
      if (this.enableLogging) {
        const eText = platformFuncs.parseError(err);
        this.log.warn('[%s] %s %s.', this.name, platformLang.storageWriteErr, eText);
      }
    }
  }

  async requestUpdate(firstRun = false) {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return;
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {},
        });

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] %s: %s.', this.name, platformLang.incPoll, JSON.stringify(res.data));
        }

        // Check the response is in a useful format
        const data = res.data.payload;
        if (data.all) {
          /*
          if (data.all.digest) {
            if (data.all.digest.togglex && data.all.digest.togglex[0]) {
              this.isToggleX = true
              this.applyUpdate(data.all.digest.togglex[0])
            } else if (data.all.digest.toggle) {
              this.isToggleX = false
              this.applyUpdate(data.all.digest.toggle)
            }
          }
          */

          // A flag to check if we need to update the accessory context
          let needsUpdate = false;

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address and hardware don't change regularly so only get on first poll
            if (firstRun && data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase();
              this.accessory.context.hardware = data.all.system.hardware.version;
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              // Check for an IP change each and every time the device is polled
              if (this.accessory.context.ipAddress !== data.all.system.firmware.innerIp) {
                this.accessory.context.ipAddress = data.all.system.firmware.innerIp;
                needsUpdate = true;
              }

              // Firmware doesn't change regularly so only get on first poll
              if (firstRun) {
                this.accessory.context.firmware = data.all.system.firmware.version;
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1;
            if (this.accessory.context.isOnline !== isOnline) {
              this.accessory.context.isOnline = isOnline;
              needsUpdate = true;
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate || firstRun) {
            this.platform.updateAccessory(this.accessory);
          }
        }
      });
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : platformFuncs.parseError(err);
      if (this.enableDebugLogging) {
        this.log.warn('[%s] %s %s.', this.name, platformLang.reqFailed, eText);
      }

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (
        (this.accessory.context.isOnline || firstRun)
        && ['EHOSTUNREACH', 'timed out'].some((el) => eText.includes(el))
      ) {
        this.accessory.context.isOnline = false;
        this.platform.updateAccessory(this.accessory);
      }
    }
  }

  receiveUpdate(params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] %s: %s.', this.name, platformLang.incMQTT, JSON.stringify(params));
      }
      if (params.payload) {
        /*
        if (params.payload.togglex && params.payload.togglex[0]) {
          this.applyUpdate(params.payload.togglex[0])
        } else if (params.payload.toggle) {
          this.applyUpdate(params.payload.toggle)
        }
        */
      }
    } catch (err) {
      const eText = platformFuncs.parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.refFailed, eText);
    }
  }
}

/*

[1/26/2022, 8:09:43 PM] [Meross] [test] initialising with options {"connection":"hybrid","logging":"debug"}.
[1/26/2022, 8:09:43 PM] [Meross] [test] initialised with id [].
[1/26/2022, 8:09:43 PM] [Meross] [test] incoming poll: {"header":{"messageId":"","namespace":"Appliance.System.All","method":"GETACK","payloadVersion":1,"from":"","uuid":"","timestamp":,"timestampMs":41,"sign":""},"payload":{"all":{"system":{"hardware":{"type":"mts200","subType":"eu","version":"7.0.0","chipType":"rtl8710cm","uuid":"","macAddress":""},"firmware":{"version":"7.3.15","homekitVersion":"4.1","compileTime":"20213","encrypt":1,"wifiMac":"","innerIp":"","server":","port":443,"userId":},"time":{"timestamp":,"timezone":"Europe","timeRule":[]},"online":{"status":1,"bindId":"","who":1}},"digest":{"thermostat":{"mode":[{"channel":0,"onoff":1,"mode":4,"state":0,"currentTemp":245,"heatTemp":250,"coolTemp":180,"ecoTemp":120,"manualTemp":240,"warning":0,"targetTemp":240,"min":50,"max":350,"lmTime":1643224182}],"windowOpened":[{"channel":0,"status":0,"lmTime":1643224182}]}}}}}.
[1/26/2022, 8:09:43 PM] [Meross] [test] has been reported [online].
*/
