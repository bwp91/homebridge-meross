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
    this.reversePolarity = this.accessory.context.options.reversePolarity;
    const cloudRefreshRate = hasProperty(platform.config, 'cloudRefreshRate')
      ? platform.config.cloudRefreshRate
      : platformConsts.defaultValues.cloudRefreshRate;
    const localRefreshRate = hasProperty(platform.config, 'refreshRate')
      ? platform.config.refreshRate
      : platformConsts.defaultValues.refreshRate;
    this.pollInterval = accessory.context.connection === 'local'
      ? localRefreshRate
      : cloudRefreshRate;

    // Add the switch services
    this.serviceOpen = this.accessory.getService('Open')
      || this.accessory.addService(this.hapServ.Switch, 'Open', 'open');
    this.serviceClose = this.accessory.getService('Close')
      || this.accessory.addService(this.hapServ.Switch, 'Close', 'close');
    this.serviceStop = this.accessory.getService('Stop')
      || this.accessory.addService(this.hapServ.Switch, 'Stop', 'stop');

    // Add the set handler to the open switch service
    this.serviceOpen
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => {
        await this.internalStateUpdate(value, this.reversePolarity ? 0 : 100, this.serviceOpen);
      })
      .updateValue(false);

    // Add the set handler to the close switch service
    this.serviceClose
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => {
        await this.internalStateUpdate(value, this.reversePolarity ? 100 : 0, this.serviceClose);
      })
      .updateValue(false);

    // Add the set handler to the stop switch service
    this.serviceStop
      .getCharacteristic(this.hapChar.On)
      .onSet(async (value) => this.internalStateUpdate(value, -1, this.serviceStop))
      .updateValue(false);

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
    this.states = {
      1: 'stopped',
      0: 'closing',
      100: 'opening',
    };

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
      reversePolarity: this.reversePolarity,
      showAs: 'switch',
    });
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts);
  }

  async internalStateUpdate(value, newPosition, hapServ) {
    try {
      // Only control when turning on a switch
      if (!value) {
        return;
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true;

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.RollerShutter.Position';
        const payload = {
          position: {
            position: newPosition,
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
        this.accessory.log(`${platformLang.curState} [${this.states[Math.abs(newPosition)]}]`);

        // Turn the switch off again after two seconds
        setTimeout(() => {
          hapServ.updateCharacteristic(this.hapChar.On, false);
        }, 2000);
      });
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err);
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`);
      setTimeout(() => {
        hapServ.updateCharacteristic(this.hapChar.On, false);
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
