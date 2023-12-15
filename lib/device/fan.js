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

    this.hk2mr = (speed) => {
      if (speed === 0) {
        return 0;
      } if (speed <= 33) {
        return 1;
      } if (speed <= 66) {
        return 2;
      }
      return 3;
    };

    this.mr2hk = (speed) => {
      if (speed === 0) {
        return 0;
      } if (speed === 1) {
        return 33;
      } if (speed === 2) {
        return 66;
      }
      return 99;
    };

    // Add the fan service if it doesn't already exist
    this.fanService = this.accessory.getService('Fan')
      || this.accessory.addService(this.hapServ.Fan, 'Fan', 'fan');

    // Add the lightbulb service if it doesn't already exist
    this.lightService = this.accessory.getService('Light')
      || this.accessory.addService(this.hapServ.Lightbulb, 'Light', 'light');

    // Add the set handler to the fan on/off service
    this.fanService
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => this.internalFanStateUpdate(value));
    this.cacheFanState = this.fanService.getCharacteristic(this.hapChar.On).value;

    this.fanService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 33,
        validValues: [0, 33, 66, 99],
      })
      .onSet(async (value) => this.internalFanSpeedUpdate(value));
    this.cacheFanSpeed = this.hk2mr(
      this.fanService.getCharacteristic(this.hapChar.RotationSpeed).value,
    );

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => this.internalLightStateUpdate(value));
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value;

    // Add the set handler to the lightbulb brightness
    this.lightService
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightnessStep })
      .onSet(async (value) => this.internalLightBrightnessUpdate(value));
    this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value;

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

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      showAs: 'switch',
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
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
          if (data.all.digest) {
            this.applyUpdate(data.all.digest);
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

  // eslint-disable-next-line class-methods-use-this
  internalFanStateUpdate(value) {
    // nothing for now
    this.accessory.logDebug(`Fan state update: ${value}`);
  }

  // eslint-disable-next-line class-methods-use-this
  internalFanSpeedUpdate(value) {
    // nothing for now
    this.accessory.logDebug(`Fan speed update: ${value}`);
  }

  // eslint-disable-next-line class-methods-use-this
  internalLightStateUpdate(value) {
    // nothing for now
    this.accessory.logDebug(`Light state update: ${value}`);
  }

  // eslint-disable-next-line class-methods-use-this
  internalLightBrightnessUpdate(value) {
    // nothing for now
    this.accessory.logDebug(`Light brightness update: ${value}`);
  }

  receiveUpdate(params) {
    try {
      if (params.payload) {
        this.applyUpdate(params.payload);
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  applyUpdate(data) {
    // from mqtt
    //     "togglex": [
    //       {
    //         "onoff": 1,
    //         "lmTime": 1702600426,
    //         "channel": 0
    //       },
    //       {
    //         "onoff": 0,
    //         "lmTime": 1702592097,
    //         "channel": 1
    //       },
    //       {
    //         "onoff": 1,
    //         "lmTime": 1702600426,
    //         "channel": 2
    //       }
    //     ]
    // channel 0 is redundant
    // channel 1 is the light state
    // channel 2 is the fan state

    if (data.togglex) {
      // Update the fan state if present
      const lightState = data.togglex.find((el) => el.channel === 1);
      if (lightState) {
        const newOn = lightState.onoff === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightState !== newOn) {
          this.lightService.updateCharacteristic(this.hapChar.On, newOn);
          this.cacheLightState = newOn;
          this.accessory.log(`${platformLang.curState} [${this.cacheLightState}]`);
        }
      }

      // Update the fan state if present
      const fanState = data.togglex.find((el) => el.channel === 2);
      if (fanState) {
        const newOn = fanState.onoff === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanState !== newOn) {
          this.fanService.updateCharacteristic(this.hapChar.On, newOn);
          this.cacheFanState = newOn;
          this.accessory.log(`${platformLang.curState} [${this.cacheFanState}]`);
        }
      }
    }

    // from polling
    // "light": {
    //   "capacity": 4,
    //   "channel": 1,
    //   "luminance": 100,
    //   "onoff": 0
    // },
    // "fan": [
    //   {
    //     "channel": 2,
    //     "speed": 4,
    //     "maxSpeed": 4
    //   }
    // ],

    if (data.fan) {
      // Update the fan state if present
      if (hasProperty(data.fan, 'onoff')) {
        const newOn = data.fan.onoff === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanState !== newOn) {
          this.fanService.updateCharacteristic(this.hapChar.On, newOn);
          this.cacheFanState = newOn;
          this.accessory.log(`${platformLang.curState} [${this.cacheFanState}]`);
        }
      }

      // Update the fan speed if present
      if (hasProperty(data.fan, 'speed')) {
        const newSpeed = data.fan.speed * 33;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanSpeed !== newSpeed) {
          this.cacheFanSpeed = newSpeed;
          const hkValue = this.mr2hk(this.cacheFanSpeed);
          this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, hkValue);
          this.accessory.log(`${platformLang.curSpeed} [${this.cacheFanSpeed}%]`);
        }
      }
    }

    if (data.light) {
      // Update the lightbulb state if present
      if (hasProperty(data.light, 'onoff')) {
        const newOn = data.light.onoff === 1;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightState !== newOn) {
          this.lightService.updateCharacteristic(this.hapChar.On, newOn);
          this.cacheLightState = newOn;
          this.accessory.log(`${platformLang.curState} [${this.cacheLightState}]`);
        }
      }

      // Update the lightbulb brightness if present
      if (hasProperty(data.light, 'luminance')) {
        const newBright = data.light.luminance;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheBright !== newBright) {
          this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright);
          this.cacheBright = newBright;
          this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`);
        }
      }
    }
  }
}
