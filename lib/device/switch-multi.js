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
    this.priAcc = this.devicesInHB.get(
      this.platform.api.hap.uuid.generate(`${accessory.context.serialNumber}0`),
    );

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet));
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch);

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => this.internalStateUpdate(value));
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value;

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, { log: () => {} });

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

    // We only need to set up mqtt client and polling for 'main' accessory (channel 0)
    if (accessory.context.channel === 0) {
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
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      hideChannels: this.accessory.context.options.hideChannels,
      showAs: 'switch',
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  async internalStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.service.getCharacteristic(this.hapChar.On).value) {
          return;
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Get the primary accessory instance to send the command
        const accessory = this.accessory.context.channel === 0 ? this.accessory : this.priAcc;

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.Control.ToggleX';
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: this.accessory.context.channel,
          },
        };

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(accessory, {
          namespace,
          payload,
        });

        // Update the cache
        this.cacheState = value;

        // Add the entry to eve history and log
        this.accessory.eveService.addEntry({ status: value ? 1 : 0 });

        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`);

        // Update the other accessories of this device with the correct status
        switch (this.accessory.context.channel) {
          case 0: {
            // Update all the sub accessories with the same status
            for (let i = 1; i < this.accessory.context.channelCount; i += 1) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
              );
              if (subAcc) {
                const hapServ = subAcc.getService(this.hapServ.Switch);
                const hapChar = hapServ.getCharacteristic(this.hapChar.On);
                if (hapChar.value !== value) {
                  hapChar.updateValue(value);

                  // Add the entry to eve history and log
                  subAcc.eveService.addEntry({ status: value ? 1 : 0 });
                  subAcc.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`);
                }
              }
            }
            break;
          }
          case 1:
          case 2:
          case 3:
          case 4:
          case 5:
          case 6: {
            let primaryState = false;
            for (let i = 1; i <= this.accessory.context.channelCount; i += 1) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
              );
              if (subAcc) {
                if (i === this.accessory.context.channel) {
                  if (value) {
                    primaryState = true;
                  }
                } else {
                  const hapServ = subAcc.getService(this.hapServ.Switch);
                  const hapChar = hapServ.getCharacteristic(this.hapChar.On);
                  if (hapChar.value) {
                    primaryState = true;
                  }
                }
              }
            }
            if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
              const hapServ = this.priAcc.getService(this.hapServ.Switch);
              const hapChar = hapServ.getCharacteristic(this.hapChar.On);
              if (hapChar.value !== primaryState) {
                hapChar.updateValue(primaryState);

                // Add the entry to eve history and log
                this.priAcc.eveService.addEntry({ status: primaryState ? 1 : 0 });
                this.priAcc.log(`${platformLang.curState} [${primaryState ? 'on' : 'off'}]`);
              }
            }
            break;
          }
          default:
        }
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.On,
          this.service.getCharacteristic(this.hapChar.On).value,
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
            for (let i = 0; i <= this.accessory.context.channelCount; i += 1) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
              );
              if (subAcc) {
                subAcc.context = {
                  ...subAcc.context,
                  ...{
                    macAddress: this.accessory.context.macAddress,
                    hardware: this.accessory.context.hardware,
                    ipAddress: this.accessory.context.ipAddress,
                    firmware: this.accessory.context.firmware,
                    isOnline: this.accessory.context.isOnline,
                  },
                };
                this.platform.updateAccessory(subAcc);
              }
            }
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
        for (let i = 0; i <= this.accessory.context.channelCount; i += 1) {
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
          );
          if (subAcc) {
            subAcc.context.isOnline = false;
            this.platform.updateAccessory(subAcc);
          }
        }
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
      // Attempt to find the accessory this channel relates to
      const accessory = channel.channel === 0
        ? this.accessory
        : this.devicesInHB.get(
          this.platform.api.hap.uuid.generate(
            this.accessory.context.serialNumber + channel.channel,
          ),
        );

      // Check the accessory exists
      if (!accessory) {
        return;
      }

      // Obtain the service and current value
      const hapServ = channel.channel === 0 ? this.service : accessory.getService(this.hapServ.Switch);
      const hapChar = hapServ.getCharacteristic(this.hapChar.On);

      // Read the current state
      const newState = channel.onoff === 1;

      // Don't continue if the state is the same as before
      if (hapChar.value === newState) {
        return;
      }

      // Update the HomeKit characteristics
      hapChar.updateValue(newState);

      // Add the entry to eve history and log
      accessory.eveService.addEntry({ status: newState ? 1 : 0 });
      this.accessory.log(`${platformLang.curState} [${newState ? 'on' : 'off'}]`);
    });

    // Check for the primary accessory state
    if (this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
      return;
    }
    let primaryState = false;
    for (let i = 1; i <= this.accessory.context.channelCount; i += 1) {
      const subAcc = this.devicesInHB.get(
        this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
      );
      if (subAcc?.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On).value) {
        primaryState = true;
      }
    }
    const hapChar = this.priAcc.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On);
    if (hapChar.value !== primaryState) {
      hapChar.updateValue(primaryState);

      // Add the entry to eve history and log
      this.priAcc.eveService.addEntry({ status: primaryState ? 1 : 0 });
      this.priAcc.log(`${platformLang.curState} [${primaryState ? 'on' : 'off'}]`);
    }
  }
}
