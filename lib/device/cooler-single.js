import PQueue from 'p-queue'; // eslint-disable-line import/no-unresolved
import { TimeoutError } from 'p-timeout';
import mqttClient from '../connection/mqtt.js';
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
    this.inUsePowerThreshold = this.accessory.context.options.inUsePowerThreshold
      || platformConsts.defaultValues.inUsePowerThreshold;
    this.name = accessory.displayName;
    const cloudRefreshRate = hasProperty(platform.config, 'cloudRefreshRate')
      ? platform.config.cloudRefreshRate
      : platformConsts.defaultValues.cloudRefreshRate;
    const localRefreshRate = hasProperty(platform.config, 'refreshRate')
      ? platform.config.refreshRate
      : platformConsts.defaultValues.refreshRate;
    this.pollInterval = accessory.context.connection === 'local'
      ? localRefreshRate
      : cloudRefreshRate;
    this.temperatureSource = accessory.context.options.temperatureSource;

    // If the accessory has any old services then remove them
    ['Switch', 'Outlet', 'AirPurifier'].forEach((service) => {
      if (this.accessory.getService(this.hapServ[service])) {
        this.accessory.removeService(this.accessory.getService(this.hapServ[service]));
      }
    });

    // Set up the accessory with default target temp when added the first time
    if (!hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 20;
    }

    // Check to make sure user has not switched from cooler to heater
    if (this.accessory.context.cacheType !== 'cooler') {
      // Remove and re-setup as a HeaterCooler
      if (this.accessory.getService(this.hapServ.HeaterCooler)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler));
      }
      this.accessory.context.cacheType = 'cooler';
      this.accessory.context.cacheTarget = 20;
    }

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
      || this.accessory.addService(this.hapServ.HeaterCooler);

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minStep: 0.1,
    });
    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value;

    // Add the set handler to the heater active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async (value) => this.internalStateUpdate(value));

    // Add options to the target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).setProps({
      minValue: 0,
      maxValue: 0,
      validValues: [0],
    });

    // Add the set handler to the target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .updateValue(this.accessory.context.cacheTarget)
      .setProps({ minStep: 0.5 })
      .onSet(async (value) => this.internalTargetTempUpdate(value));

    // Initialise these caches now since they aren't determined by the initial externalUpdate()
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1;
    this.cacheCool = this.cacheState
      && this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).value === 3;

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

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new mqttClient(platform, this.accessory);
      this.accessory.mqtt.connect();
    }

    // Always request a device update on startup, then start the interval for polling
    setTimeout(() => this.requestUpdate(true), 2000);
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    );

    // Set up an interval to get regular temperature updates
    setTimeout(() => {
      this.getTemperature();
      this.accessory.powerInterval = setInterval(
        () => this.getTemperature(),
        120000,
      );
    }, 5000);

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      showAs: 'cooler',
      temperatureSource: this.temperatureSource,
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  async internalStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        let newState;
        let newCool;
        let newValue;
        if (value !== 0) {
          newState = true;
          if (this.cacheTemp > this.accessory.context.cacheTarget) {
            newValue = true;
            newCool = true;
          }
        }

        // Only send the update if either:
        // * The new value (state) is OFF and the cacheCool was ON
        // * The new value (state) is ON and newCool is 'on'
        if ((value === 0 && this.cacheCool) || (value === 1 && newCool)) {
          // This flag stops the plugin from requesting updates while pending on others
          this.updateInProgress = true;

          // The plugin should have determined if it's 'toggle' or 'togglex' on the first poll run
          let namespace;
          let payload;
          if (this.isToggleX) {
            namespace = 'Appliance.Control.ToggleX';
            payload = {
              togglex: {
                onoff: newValue ? 1 : 0,
                channel: 0,
              },
            };
          } else {
            namespace = 'Appliance.Control.Toggle';
            payload = {
              toggle: {
                onoff: newValue ? 1 : 0,
              },
            };
          }

          // Use the platform function to send the update to the device
          await this.platform.sendUpdate(this.accessory, {
            namespace,
            payload,
          });
        }
        if (newState !== this.cacheState) {
          this.cacheState = newState;
          this.accessory.log(`${platformLang.curState} [${this.cacheState ? 'on' : 'off'}]`);
        }
        if (newCool !== this.cacheCool) {
          this.cacheCool = newCool;
          this.accessory.log(`${platformLang.curCool} [${this.cacheCool ? 'on' : 'off'}]`);
        }
        const newOnState = this.cacheCool ? 3 : 1;
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeaterCoolerState,
          value === 1 ? newOnState : 0,
        );
      });
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState ? 1 : 0);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalTargetTempUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        if (value === this.accessory.context.cacheTarget) {
          return;
        }
        this.accessory.context.cacheTarget = value;
        this.accessory.log(`${platformLang.curTarg} [${value}°C]`);
        if (!this.cacheState) {
          return;
        }
        let newCool;
        let newValue;
        if (this.cacheTemp > value) {
          newValue = true;
          newCool = true;
        }
        if (newCool === this.cacheCool) {
          return;
        }
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // The plugin should have determined if it's 'toggle' or 'togglex' on the first poll run
        let namespace;
        let payload;
        if (this.isToggleX) {
          namespace = 'Appliance.Control.ToggleX';
          payload = {
            togglex: {
              onoff: newValue ? 1 : 0,
              channel: 0,
            },
          };
        } else {
          namespace = 'Appliance.Control.Toggle';
          payload = {
            toggle: {
              onoff: newValue ? 1 : 0,
            },
          };
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Cache and log
        this.cacheCool = newCool;

        this.accessory.log(`${platformLang.curCool} [${this.cacheCool ? 'on' : 'off'}]`);

        this.service.updateCharacteristic(
          this.hapChar.CurrentHeaterCoolerState,
          this.cacheCool ? 3 : 1,
        );
      });
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.HeatingThresholdTemperature,
          this.accessory.context.cacheTarget,
        );
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalCurrentTempUpdate() {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        if (!this.cacheState) {
          return;
        }
        let newCool;
        let newValue;
        if (this.cacheTemp > this.accessory.context.cacheTarget) {
          newValue = true;
          newCool = true;
        }
        if (newCool === this.cacheCool) {
          return;
        }
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // The plugin should have determined if it's 'toggle' or 'togglex' on the first poll run
        let namespace;
        let payload;
        if (this.isToggleX) {
          namespace = 'Appliance.Control.ToggleX';
          payload = {
            togglex: {
              onoff: newValue ? 1 : 0,
              channel: 0,
            },
          };
        } else {
          namespace = 'Appliance.Control.Toggle';
          payload = {
            toggle: {
              onoff: newValue ? 1 : 0,
            },
          };
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Cache and log
        this.cacheCool = newCool;

        this.accessory.log(`${platformLang.curCool} [${this.cacheCool ? 'on' : 'off'}]`);
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeaterCoolerState,
          this.cacheCool ? 2 : 1,
        );
      });
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
    }
  }

  async getTemperature() {
    try {
      // Skip polling if the storage hasn't initialised properly
      if (!this.platform.storageClientData) {
        return;
      }

      const newTemp = await this.platform.storageData.getItem(`${this.temperatureSource}_temp`);
      if (newTemp && newTemp !== this.cacheTemp) {
        this.cacheTemp = newTemp;
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp);
        this.accessory.eveService.addEntry({ temp: this.cacheTemp });

        this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C]`);
        await this.internalCurrentTempUpdate();
      }
    } catch (err) {
      this.accessory.logWarn(parseError(err));
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
        this.accessory.logDebug(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`);

        // Check the response is in a useful format
        const data = res.data.payload;
        if (data.all) {
          if (firstRun && data.all.digest) {
            if (data.all.digest.togglex && data.all.digest.togglex[0]) {
              this.isToggleX = true;
            }
          }

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
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logDebugWarn(`${platformLang.reqFailed}: ${eText}`);

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
}
