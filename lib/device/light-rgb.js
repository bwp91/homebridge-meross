import PQueue from 'p-queue'; // eslint-disable-line import/no-unresolved
import { TimeoutError } from 'p-timeout';
import mqttClient from '../connection/mqtt.js';
import {
  hk2mrCT,
  hk2mrRGB,
  hs2rgb,
  mr2hkCT,
  mr2hkRGB,
  rgb2hs,
} from '../utils/colour-utils.js';
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
    this.alShift = this.accessory.context.options.adaptiveLightingShift
      || platformConsts.defaultValues.adaptiveLightingShift;
    this.brightnessStep = this.accessory.context.options.brightnessStep || platformConsts.defaultValues.brightnessStep;
    this.brightnessStep = Math.min(this.brightnessStep, 100);
    this.cacheMode = 'rgb';
    this.enableLogging = accessory.context.enableLogging;
    this.enableDebugLogging = accessory.context.enableDebugLogging;
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

    // Add the lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb);

    // If adaptive lighting has just been disabled then remove and re-add service to hide AL icon
    if (this.alShift === -1 && this.accessory.context.adaptiveLighting) {
      this.accessory.removeService(this.service);
      this.service = this.accessory.addService(this.hapServ.Lightbulb);
      this.accessory.context.adaptiveLighting = false;
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => this.internalStateUpdate(value));
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value;

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightnessStep })
      .onSet(async (value) => this.internalBrightnessUpdate(value));
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value;

    // Add the set handler to the lightbulb hue characteristic
    this.service
      .getCharacteristic(this.hapChar.Hue)
      .onSet(async (value) => this.internalColourUpdate(value));
    this.cacheHue = this.service.getCharacteristic(this.hapChar.Hue).value;
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value;

    // Add the set handler to the lightbulb colour temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.ColorTemperature)
      .onSet(async (value) => this.internalCTUpdate(value));
    this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value;

    // Set up the adaptive lighting controller if not disabled by user
    if (this.alShift !== -1) {
      this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
      });
      this.accessory.configureController(this.alController);
      this.accessory.context.adaptiveLighting = true;
    }

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
      adaptiveLightingShift: this.alShift,
      brightnessStep: this.brightnessStep,
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : normalLogging,
    });
    this.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);

    /*
      CAPACITIES
      1 - rgb to rgb
      2 - cct to cct
      4 - brightness
      5 - cct to rgb
      6 - rgb to cct
    */
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
        const namespace = 'Appliance.Control.ToggleX';
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: 0,
          },
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
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheBright === value) {
          return;
        }

        // Avoid multiple changes in short space of time
        const updateKey = platformFuncs.generateRandomString(5);
        this.updateKeyBright = updateKey;
        await platformFuncs.sleep(300);
        if (updateKey !== this.updateKeyBright) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload to send for the correct device model
        const payload = {
          light: {
            luminance: value,
            capacity: 4,
            channel: 0,
          },
        };

        // Generate the namespace
        const namespace = 'Appliance.Control.Light';

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.cacheBright = value;
        if (this.enableLogging) {
          this.log('[%s] current brightness [%s%].', this.name, value);
        }
      });
    } catch (err) {
      const eText = platformFuncs.parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalColourUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Avoid multiple changes in short space of time
        const updateKey = platformFuncs.generateRandomString(5);
        this.updateKeyColour = updateKey;
        await platformFuncs.sleep(300);
        if (updateKey !== this.updateKeyColour) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Convert to RGB
        const saturation = this.service.getCharacteristic(this.hapChar.Saturation).value;
        const [r, g, b] = hs2rgb(value, saturation);

        // Generate the payload to send
        const payload = {
          light: {
            rgb: hk2mrRGB(r, g, b),
            capacity: this.cacheMode === 'rgb' ? 1 : 5,
            luminance: this.cacheBright,
            channel: 0,
          },
        };

        // Generate the namespace
        const namespace = 'Appliance.Control.Light';

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Updating the cct to the lowest value mimics native adaptive lighting
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140);

        // Update the cache and log the update has been successful
        this.cacheHue = value;
        this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value;
        this.cacheMired = 0;
        this.cacheMode = 'rgb';
        if (this.enableLogging) {
          this.log(
            '[%s] current hue/sat [%s, %s] rgb [%s, %s, %s].',
            this.name,
            this.cacheHue,
            this.cacheSat,
            r,
            g,
            b,
          );
        }
      });
    } catch (err) {
      const eText = platformFuncs.parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue);
      }, 2000);
      throw new this.hapErr(-70402);
    }
  }

  async internalCTUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Avoid multiple changes in short space of time
        const updateKey = platformFuncs.generateRandomString(5);
        this.updateKeyCT = updateKey;
        await platformFuncs.sleep(300);
        if (updateKey !== this.updateKeyCT) {
          return;
        }

        // Flag for update is called by Adaptive Lighting
        const isAdaptiveLighting = this.alController && this.alController.isAdaptiveLightingActive();

        // Don't continue with AL update if OFF or mired is same as before
        if (isAdaptiveLighting) {
          if (!this.cacheState || this.cacheMired === value) {
            return;
          }
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload to send
        const payload = {
          light: {
            temperature: hk2mrCT(value),
            capacity: this.cacheMode === 'cct' ? 2 : 6,
            luminance: this.cacheBright,
            channel: 0,
          },
        };

        // Generate the namespace
        const namespace = 'Appliance.Control.Light';

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Updating the hue/sat to the corresponding values mimics native adaptive lighting
        const hs = this.platform.api.hap.ColorUtils.colorTemperatureToHueAndSaturation(value);
        this.service.updateCharacteristic(this.hapChar.Hue, hs.hue);
        this.service.updateCharacteristic(this.hapChar.Saturation, hs.saturation);

        // Update the cache and log the update has been successful
        this.cacheMired = value;
        this.cacheMode = 'cct';
        this.cacheHue = 0;
        this.cacheSat = 0;
        if (this.enableLogging) {
          this.log(
            '[%s] current mired/kelvin [%s/%s]%s.',
            this.name,
            this.cacheMired,
            Math.round(1000000 / this.cacheMired),
            isAdaptiveLighting ? ' via adaptive lighting' : '',
          );
        }
      });
    } catch (err) {
      const eText = platformFuncs.parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.sendFailed, eText);
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired);
      }, 2000);
      throw new this.hapErr(-70402);
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

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received');
      }
      const data = params.payload;
      if (data.togglex || data.light) {
        this.applyUpdate(data);
      }
    } catch (err) {
      const eText = platformFuncs.parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.refFailed, eText);
    }
  }

  applyUpdate(data) {
    if (data.togglex && data.togglex[0] && platformFuncs.hasProperty(data.togglex[0], 'onoff')) {
      // newState is given as 0 or 1 -> convert to bool for HomeKit
      const newState = data.togglex[0].onoff === 1;

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheState !== newState) {
        this.service.updateCharacteristic(this.hapChar.On, newState);
        this.cacheState = newState;
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off');
        }
      }
    }
    if (data.light) {
      if (platformFuncs.hasProperty(data.light, 'luminance')) {
        const newBright = data.light.luminance;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheBright !== newBright) {
          this.service.updateCharacteristic(this.hapChar.Brightness, newBright);
          this.cacheBright = newBright;
          if (this.enableLogging) {
            this.log('[%s] current brightness [%s%].', this.name, this.cacheBright);
          }
        }
      }
      if (platformFuncs.hasProperty(data.light, 'rgb') && [1, 5].includes(data.light.capacity)) {
        const [r, g, b] = mr2hkRGB(data.light.rgb);
        const [newHue, newSat] = rgb2hs(r, g, b);
        this.cacheMode = 'rgb';
        this.cacheMired = 0;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheHue !== newHue || this.cacheSat !== newSat) {
          this.service.updateCharacteristic(this.hapChar.Hue, newHue);
          this.service.updateCharacteristic(this.hapChar.Saturation, newSat);
          this.cacheHue = newHue;
          this.cacheSat = newSat;
          if (this.enableLogging) {
            this.log(
              '[%s] current hue/sat [%s, %s] rgb [%s, %s, %s].',
              this.name,
              this.cacheHue,
              this.cacheSat,
              r,
              g,
              b,
            );
          }
        }
        //  Disable adaptive lighting
        if (this.alController && this.alController.isAdaptiveLightingActive()) {
          this.alController.disableAdaptiveLighting();
          if (this.enableLogging) {
            this.log('[%s] adaptive lighting disabled as RGB colour chosen.', this.name);
          }
        }
      }
      if (
        platformFuncs.hasProperty(data.light, 'temperature')
        && [2, 6].includes(data.light.capacity)
      ) {
        const hkTemp = mr2hkCT(data.light.temperature);
        this.cacheMode = 'cct';
        this.cacheHue = 0;

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheMired !== hkTemp) {
          const dif = Math.abs(this.cacheMired - hkTemp);
          this.service.updateCharacteristic(this.hapChar.ColorTemperature, hkTemp);
          this.cacheMired = hkTemp;
          if (this.enableLogging) {
            const kelvin = Math.round(1000000 / this.cacheMired);
            this.log('[%s] current mired/kelvin [%s/%s].', this.name, this.cacheMired, kelvin);
          }
          if (dif > 10 && this.alController && this.alController.isAdaptiveLightingActive()) {
            this.alController.disableAdaptiveLighting();
            if (this.enableLogging) {
              this.log('[%s] adaptive lighting disabled due to change of mired.', this.name);
            }
          }
        }
      }
    }
  }
}
