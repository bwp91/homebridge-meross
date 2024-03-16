import PQueue from 'p-queue'; // eslint-disable-line import/no-unresolved
import { TimeoutError } from 'p-timeout';
import mqttClient from '../connection/mqtt.js';
import platformConsts from '../utils/constants.js';
import { hasProperty, parseError } from '../utils/functions.js';
import platformLang from '../utils/lang-en.js';

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.devicesInHB = platform.devicesInHB;
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

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch));
    }

    // Add the outlet services for each channel
    for (let i = 0; i < accessory.context.channelCount; i += 1) {
      if (i !== 0) {
        const outletService = this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${i}`);
        if (!outletService) {
          this.accessory.addService(this.hapServ.Outlet, `Outlet ${i}`, `outlet-${i}`);
        }
      }
    }

    // Add the set handler to the switch on/off characteristic for each channel
    for (let i = 0; i < accessory.context.channelCount; i += 1) {
      if (i !== 0) {
        const outletService = this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${i}`);
        outletService
          .getCharacteristic(this.hapChar.On)
          .onSet(async (value) => this.internalStateUpdate(value, i));
      }
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
    setTimeout(() => this.requestUpdate(true), 2000);
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    );

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      hideChannels: this.accessory.context.options.hideChannels,
      showAs: 'outlet',
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  async internalStateUpdate(value, channel) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${channel}`)
          .getCharacteristic(this.hapChar.On).value) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.Control.ToggleX';
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel,
          },
        };

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        });

        // Update the cache and log the update has been successful
        this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${channel}`)
          .getCharacteristic(this.hapChar.On).updateValue(value);

        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`);
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
      setTimeout(() => {
        this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${channel}`)
          .getCharacteristic(this.hapChar.On).updateValue(
            this.accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${channel}`)
              .getCharacteristic(this.hapChar.On).value,
          );
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
        this.accessory.logDebug(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`);

        // Check the response is in a useful format
        const data = res.data.payload;
        if (data.all) {
          if (
            data.all.digest
                        && data.all.digest.togglex
                        && Array.isArray(data.all.digest.togglex)
          ) {
            this.applyUpdate(data.all.digest.togglex);
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
            this.accessory.context = {
              ...this.accessory.context,
              ...{
                macAddress: this.accessory.context.macAddress,
                hardware: this.accessory.context.hardware,
                ipAddress: this.accessory.context.ipAddress,
                firmware: this.accessory.context.firmware,
                isOnline: this.accessory.context.isOnline,
              },
            };
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

  receiveUpdate(params) {
    try {
      // Log the received data
      this.accessory.logDebug(`${platformLang.incMQTT}: ${JSON.stringify(params)}`);

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received');
      }
      const data = params.payload;

      // Check the data is in a format which contains the value we need
      if (data.togglex) {
        // payload.togglex can either be an array of objects (multiple channels) or a single object
        // Either way, push all items into one array
        const toUpdate = [];
        if (Array.isArray(data.togglex)) {
          data.togglex.forEach((item) => toUpdate.push(item));
        } else {
          toUpdate.push(data.togglex);
        }
        this.applyUpdate(toUpdate);
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`);
    }
  }

  applyUpdate(data) {
    data.forEach((channel) => {
      if (channel.channel === 0) return;

      // Attempt to find the accessory this channel relates to
      const { accessory } = this;

      // Obtain the service and current value
      const hapServ = accessory.getServiceByUUIDAndSubType(this.hapServ.Outlet, `outlet-${channel.channel}`);
      const hapChar = hapServ.getCharacteristic(this.hapChar.On);

      // Read the current state
      const newState = channel.onoff === 1;

      // Don't continue if the state is the same as before
      if (hapChar.value === newState) {
        return;
      }

      // Update the HomeKit characteristics and log
      hapChar.updateValue(newState);
      this.accessory.log(`${platformLang.curState} [${newState ? 'on' : 'off'}]`);
    });
  }
}
