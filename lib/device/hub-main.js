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
    this.log = platform.log;
    this.platform = platform;

    // Set up variables from the accessory
    this.accessory = accessory;
    this.enableLogging = accessory.context.enableLogging;
    this.enableDebugLogging = accessory.context.enableDebugLogging;
    this.mtsList = [];
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

    // Not sure how realtime mqtt updates work with this device, so force enable cloud polling
    if (this.pollInterval === 0) {
      this.pollInterval = 30000;
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
    setTimeout(() => this.requestUpdate(true), 5000);
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    );
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
          if (
            data.all.digest
            && data.all.digest.hub
            && data.all.digest.hub.subdevice
            && Array.isArray(data.all.digest.hub.subdevice)
          ) {
            data.all.digest.hub.subdevice.forEach((subdevice) => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(
                  this.accessory.context.serialNumber + subdevice.id,
                ),
              );

              // No need to continue if the accessory doesn't exist nor the receiver function
              if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
                return;
              }

              // Properties we need are in ms100 object
              if (subdevice.ms100) {
                // Apply the update to the accessory
                const update = {};
                if (hasProperty(subdevice.ms100, 'latestTemperature')) {
                  update.temperature = subdevice.ms100.latestTemperature;
                }
                if (hasProperty(subdevice.ms100, 'latestHumidity')) {
                  update.humidity = subdevice.ms100.latestHumidity;
                }
                if (hasProperty(subdevice.ms100, 'voltage')) {
                  update.voltage = subdevice.ms100.voltage;
                }
                subAcc.control.applyUpdate(update);
              } else if (subdevice.status === 2) {
                // If the status is 2 then has been reported offline - report a battery of 0
                subAcc.control.applyUpdate({ voltage: 0 });
              }

              // Check to see if any MTS exist
              if (hasProperty(subdevice, 'scheduleBMode')) {
                this.mtsList.push(subdevice.id);
              }
            });
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
            this.devicesInHB.forEach((subAcc) => {
              if (subAcc.context.serialNumber === this.accessory.context.serialNumber) {
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
            });
          }
        }

        // Request status for any MTS devices that exist
        if (this.mtsList.length > 0) {
          const payload = { all: [] };
          this.mtsList.forEach((id) => payload.all.push({ id }));

          // Send the request
          const res2 = await this.platform.sendUpdate(this.accessory, {
            namespace: 'Appliance.Hub.Mts100.All',
            payload,
            method: 'GET',
          });

          // Log the received data
          if (this.enableDebugLogging) {
            this.log('[%s] %s: %s.', this.name, platformLang.incPoll, JSON.stringify(res2.data));
          }

          const data2 = res2.data.payload;
          if (data2.all && Array.isArray(data2.all)) {
            data2.all.forEach((entry) => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + entry.id),
              );

              // No need to continue if the accessory doesn't exist nor the receiver function
              if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
                return;
              }

              const toReturn = {};
              if (entry.togglex && hasProperty(entry.togglex, 'onoff')) {
                toReturn.state = entry.togglex.onoff;
              }
              if (entry.temperature) {
                if (hasProperty(entry.temperature, 'room')) {
                  toReturn.currTemperature = entry.temperature.room / 10;
                }
                if (hasProperty(entry.temperature, 'currentSet')) {
                  toReturn.targTemperature = entry.temperature.currentSet / 10;
                }
                if (hasProperty(entry.temperature, 'openWindow')) {
                  toReturn.openWindow = entry.temperature.openWindow;
                }
              }
              if (entry.mode && hasProperty(entry.mode, 'state')) {
                toReturn.mode = entry.mode.state;
              }

              // Apply the update
              if (Object.keys(toReturn).length > 0) {
                subAcc.control.applyUpdate(toReturn);
              }
            });
          }
        }
      });
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
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

  async requestSubdevices() {
    try {
      /*
        This function is unused but would be nice to find the correct payload to
        be able to request a subdevice list from the device itself rather than
        from the cloud.
      */
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.Hub.SubdeviceList',
          payload: {
            all: [],
          },
        });

        // Log the received data
        if (this.enableDebugLogging) {
          this.log.error('[%s] incoming subdevices: %s.', this.name, JSON.stringify(res.data));
        }
      });
    } catch (err) {
      const eText = parseError(err);
      this.log.warn('[%s] failed to request subdevices as %s.', this.name, eText);
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

      if (data.togglex && Array.isArray(data.togglex)) {
        data.togglex.forEach((entry) => {
          // Check whether the homebridge accessory this relates to exists
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + entry.id),
          );

          // No need to continue if the accessory doesn't exist nor the receiver function
          if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
            return;
          }

          const toReturn = {};
          if (hasProperty(entry, 'onoff')) {
            toReturn.state = entry.onoff;
          }

          // Apply the update
          if (Object.keys(toReturn).length > 0) {
            subAcc.control.applyUpdate(toReturn);
          }
        });
      }

      if (data.temperature && Array.isArray(data.temperature)) {
        data.temperature.forEach((entry) => {
          // Check whether the homebridge accessory this relates to exists
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + entry.id),
          );

          // No need to continue if the accessory doesn't exist nor the receiver function
          if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
            return;
          }

          const toReturn = {};
          if (hasProperty(entry, 'currentSet')) {
            toReturn.targTemperature = entry.currentSet / 10;
          }
          if (hasProperty(entry, 'room')) {
            toReturn.currTemperature = entry.room / 10;
          }
          if (hasProperty(entry, 'openWindow')) {
            toReturn.openWindow = entry.openWindow;
          }

          // Apply the update
          if (Object.keys(toReturn).length > 0) {
            subAcc.control.applyUpdate(toReturn);
          }
        });
      }
      if (data.mode && Array.isArray(data.mode)) {
        data.mode.forEach((entry) => {
          // Check whether the homebridge accessory this relates to exists
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + entry.id),
          );

          // No need to continue if the accessory doesn't exist nor the receiver function
          if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
            return;
          }

          const toReturn = {};
          if (hasProperty(entry, 'state')) {
            toReturn.mode = entry.state;
          }

          // Apply the update
          if (Object.keys(toReturn).length > 0) {
            subAcc.control.applyUpdate(toReturn);
          }
        });
      }
    } catch (err) {
      const eText = parseError(err);
      this.log.warn('[%s] %s %s.', this.name, platformLang.refFailed, eText);
    }
  }
}
