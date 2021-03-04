import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { PLATFORM_NAME, PLUGIN_NAME, MerossCloudPlatformConfig } from './settings';
import { GarageDoor } from './devices/garagedoors';
import { lightBulb } from './devices/lightbulbs';
import { Outlet } from './devices/outlets';
import { Switch } from './devices/switches';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class Meross implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public axios: AxiosInstance = axios.create({
    responseType: 'json',
  });

  debugMode!: boolean;
  existingAccessory: PlatformAccessory<Record<string, any>> | undefined;

  constructor(
    public readonly log: Logger,
    public readonly config: MerossCloudPlatformConfig,
    //private readonly DevicesConfig: Map<string, DevicesConfig> = new Map(),
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.log.warn('This plugin has not been tested under HOOBS, it is highly recommended that ' +
        'you switch to Homebridge: https://git.io/Jtxb0');
    }

    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }


    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');

    // setup axios interceptor to add headers / api key to each request
    this.axios.interceptors.request.use((request: AxiosRequestConfig) => {
      request.headers['Content-Type'] = 'application/json';
      return request;
    });

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    /**
     * Hidden Device Discovery Option
     * This will disable adding any device and will just output info.
     */
    this.config.name;

    if (this.config.devices) {
      for (const device of this.config.devices!) {
        if (!device.name) {
          throw new Error(`The devices config section is missing the name in the config. This device will be skipped. ${device.name}`);
        }
        if (!device.model) {
          throw new Error(`The devices config section is missing the model the config. This device will be skipped. ${device.name}`);
        }
        if (!device.deviceUrl) {
          throw new Error(`The devices config section is missing the deviceUrl the config. This device will be skipped. ${device.name}`);
        }
        if (!device.messageId) {
          throw new Error(`The devices config section is missing the messageId the config. This device will be skipped. ${device.name}`);
        }
        if (!device.timestamp) {
          throw new Error(`The devices config section is missing the timestamp the config. This device will be skipped. ${device.name}`);
        }
        if (!device.sign) {
          throw new Error(`The devices config section is missing the sign the config. This device will be skipped. ${device.name}`);
        }
        if (!device.channel) {
          device.channel = 0;
        }
      }
    } else {
      throw new Error('The devices config section is missing from the config. This device will be skipped.');
    }

    if (this.config.refreshRate! < 1) {
      throw new Error('Refresh Rate must be above 1 (1 seconds).');
    }

    if (!this.config.refreshRate) {
      this.config.refreshRate! = 60;
      this.log.warn('Using Default Refresh Rate.');
    }

    if (!this.config.pushRate) {
      // default 100 milliseconds
      this.config.pushRate! = 0.1;
      this.log.warn('Using Default Push Rate.');
    }
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    for (const device of this.config.devices!) {

      // generate a unique id for the accessory
      const uuid = this.api.hap.uuid.generate(`${device.name!}-${device.deviceUrl!}`);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      this.existingAccessory = existingAccessory;

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // create the accessory handler for the restored accessory
        // this is imported from `devices.ts`
        switch (device.model) {
          case 'MSL-100':
          case 'MSL-420':
          case 'MSL-120':
          case 'MSL-320':
          case 'MSS560':
            new lightBulb(this, existingAccessory, device);
            break;
          case 'MSS510':
          case 'MSS510M':
          case 'MSS530H':
          case 'MSS550':
          case 'MSS570':
          case 'MSS5X0':
            new Switch(this, existingAccessory, device);
            break;
          case 'MSG100':
          case 'MSG200':
            new GarageDoor(this, existingAccessory, device);
            break;
          case 'MSS210':
          case 'MSS310':
          case 'MSS420F':
          case 'MSS425':
          case 'MSS425E':
          case 'MSS425F':
          case 'MSS630':
          case 'MSS620':
          case 'MSS110-1':
          case 'MSS110-2':
          default:
            new Outlet(this, existingAccessory, device);
        }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.name!, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        switch (device.model) {
          case 'MSL-100':
          case 'MSL-120':
          case 'MSL-320':
          case 'MSL-420':
          case 'MSS560':
            new lightBulb(this, accessory, device);
            break;
          case 'MSS510':
          case 'MSS510M':
          case 'MSS530H':
          case 'MSS550':
          case 'MSS570':
          case 'MSS5X0':
            new Switch(this, accessory, device);
            break;
          case 'MSG100':
          case 'MSG200':
            new GarageDoor(this, accessory, device);
            break;
          case 'MSS210':
          case 'MSS310':
          case 'MSS420F':
          case 'MSS425':
          case 'MSS425E':
          case 'MSS425F':
          case 'MSS630':
          case 'MSS620':
          case 'MSS110-1':
          case 'MSS110-2':
          default:
            new Outlet(this, accessory, device);
        }
        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}