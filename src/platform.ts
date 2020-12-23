import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { interval } from 'rxjs';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as qs from 'querystring';
import { readFileSync, writeFileSync } from 'fs';
import { PLATFORM_NAME, PLUGIN_NAME, AuthURL, LocationURL, DeviceURL, UIurl } from './settings';
import { T9thermostat } from './Thermostats/T9thermostat';
import { T5thermostat } from './Thermostats/T5thermostat';
import { RoundThermostat } from './Thermostats/RoundThermostat';
import { TCCthermostat } from './Thermostats/TCCthermostat';
import { LeakSensor } from './Sensors/leakSensors';
import { RoomSensors } from './RoomSensors/roomSensors';
import { RoomSensorThermostat } from './RoomSensors/roomSensorThermostat';
import {
  location,
  sensorAccessory,
  accessoryAttribute,
  T9Thermostat,
  T9groups,
  T5Device,
  RoundDevice,
  TCCDevice,
  LeakDevice,
  inBuiltSensorState,
  Settings,
  HoneywellPlatformConfig,
} from './configTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HoneywellHomePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public axios: AxiosInstance = axios.create({
    responseType: 'json',
  });

  locations?;
  firmware!: accessoryAttribute['softwareRevision'];
  sensorAccessory!: sensorAccessory;

  public sensorData = [];
  private refreshInterval;

  constructor(public readonly log: Logger, public readonly config: HoneywellPlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
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

    // setup axios interceptor to add headers / api key to each request
    this.axios.interceptors.request.use((request: AxiosRequestConfig) => {
      request.headers.Authorization = `Bearer ${this.config.credentials ?.accessToken}`;
      request.params = request.params || {};
      request.params.apikey = this.config.credentials ?.consumerKey;
      request.headers['Content-Type'] = 'application/json';
      return request;
    });

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      await this.refreshAccessToken();
      try {
        this.locations = await this.discoverlocations();
      } catch (e) {
        this.log.error('Failed to Discover Locations.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
      try {
        this.discoverDevices();
      } catch (e) {
        this.log.error('Failed to Discover Devices.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
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
    this.config.devicediscovery;

    this.config.options = this.config.options || {};

    if (this.config.options ?.thermostat) {
      // Thermostat Config Options
      this.config.options.thermostat.hide;
      this.config.options.thermostat.hide_fan;
      this.config.options.thermostat.thermostatSetpointStatus =
        this.config.options.thermostat.thermostatSetpointStatus || 'PermanentHold';
    }

    if (this.config.options ?.leaksensor) {
      // Leak Sensor Config Options
      this.config.options.leaksensor.hide;
      this.config.options.leaksensor.hide_humidity;
      this.config.options.leaksensor.hide_temperature;
      this.config.options.leaksensor.hide_leak;
    }

    if (this.config.options ?.roomsensor) {
      // Room Sensor Config Options
      this.config.options.roomsensor.hide;
      this.config.options.roomsensor.hide_temperature;
      this.config.options.roomsensor.hide_occupancy;
      this.config.options.roomsensor.hide_humidity;
    }

    if (this.config.options ?.roompriority) {
      // Room Priority Config Options
      this.config.options.roompriority.thermostat;
      this.config.options.roompriority.priorityType = this.config.options.roompriority.priorityType || 'PickARoom';
    }

    if (this.config.options) {
      this.config.options.ttl = this.config.options!.ttl || 300; // default 300 seconds
    }

    if (!this.config.credentials ?.consumerSecret && this.config.options!.ttl! < 300) {
      this.log.debug('TTL must be set to 300 or higher unless you setup your own consumerSecret.');
      this.config.options!.ttl! = 300;
    }

    if (!this.config.credentials) {
      throw new Error('Missing Credentials');
    }
    if (!this.config.credentials.consumerKey) {
      throw new Error('Missing consumerKey');
    }
    if (!this.config.credentials.refreshToken) {
      throw new Error('Missing refreshToken');
    }
  }

  async refreshAccessToken() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => this.getAccessToken(), (1800 / 3) * 1000);
    await this.getAccessToken();
  }

  /**
   * Exchange the refresh token for an access token
   */
  async getAccessToken() {
    try {
      let result;

      if (this.config.credentials!.consumerSecret) {
        // this.log.debug('Logging into honeywell', new Error());
        result = (
          await axios({
            url: AuthURL,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            auth: {
              username: this.config.credentials!.consumerKey,
              password: this.config.credentials!.consumerSecret,
            },
            data: qs.stringify({
              grant_type: 'refresh_token',
              refresh_token: this.config.credentials!.refreshToken,
            }),
            responseType: 'json',
          })
        ).data;
      } else {
        this.log.warn('Please re-link your account in the Homebridge UI.');
        // if no consumerSecret is defined, attempt to use the shared consumerSecret
        try {
          result = (
            await axios.post(UIurl, {
              consumerKey: this.config.credentials!.consumerKey,
              refresh_token: this.config.credentials!.refreshToken,
            })
          ).data;
        } catch (e) {
          this.log.error('Failed to exchange refresh token for an access token.', JSON.stringify(e.message));
          this.log.debug(JSON.stringify(e));
          throw e;
        }
      }

      this.config.credentials!.accessToken = result.access_token;
      this.log.warn('Got access token:', this.config.credentials!.accessToken);

      // check if the refresh token has changed
      if (result.refresh_token !== this.config.credentials!.refreshToken) {
        this.log.warn('New refresh token:', result.refresh_token);
        await this.updateRefreshToken(result.refresh_token);
      }

      this.config.credentials!.refreshToken = result.refresh_token;
    } catch (e) {
      this.log.error('Failed to refresh access token.', JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
    }
  }

  /**
   * The refresh token will periodically change.
   * This method saves the updated refresh token in the config.json file
   * @param newRefreshToken
   */
  async updateRefreshToken(newRefreshToken: string) {
    try {
      // check the new token was provided
      if (!newRefreshToken) {
        throw new Error('New token not provided');
      }

      // load in the current config
      const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));

      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }

      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // check the .credentials is an object before doing object things with it
      if (typeof pluginConfig.credentials !== 'object') {
        throw new Error('pluginConfig.credentials is not an object');
      }

      // set the refresh token
      pluginConfig.credentials.refreshToken = newRefreshToken;

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));

      this.log.warn('Homebridge config.json has been updated with new refresh token.');
    } catch (e) {
      this.log.error('Failed to update refresh token in config:', JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
    }
  }

  /**
   * this method discovers the Locations
   */
  async discoverlocations() {
    // try and get the access token. If it fails stop here.
    /*
    try {
      await this.getAccessToken();
    } catch (e) {
      this.log.error('Failed to refresh access token.', JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    } */
    const locations = (await this.axios.get(LocationURL)).data;
    this.log.info(`Total Locations Found: ${locations.length}`);
    // this.log.error('Locations - ', JSON.stringify(locations, null, 2));
    return locations;
  }

  /**
   * this method discovers the rooms at each location
   */
  public async getCurrentSensorData(device: T9Thermostat, group: T9groups, locationId: location['locationID']) {
    if (!this.sensorData[device.deviceID] || this.sensorData[device.deviceID].timestamp < Date.now()) {
      // this.log.info('getCurrentSensorData Read %s %s - %s', device.deviceType, device.deviceModel, device.userDefinedDeviceName);
      /*
      const thermostats = await this.axios.get(`${DeviceURL}/thermostats`, {
        params: {
          locationId: locationId,
        },
      });
      */
      // this.log.info('getCurrentSensorData Thermostats %s %s - %s', device.deviceType, device.deviceModel, device.userDefinedDeviceName);
      const response = await this.axios.get(`${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, {
        params: {
          locationId: locationId,
        },
      });

      // this.log.error('getCurrentSensorData - Result', `${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, JSON.stringify(response.data, null, 2));
      this.sensorData[device.deviceID] = {
        timestamp: Date.now() + 45000,
        data: this.normalizeSensorDate(response.data),
      };
    } else {
      // this.log.info('getCurrentSensorData Cache %s %s - %s', device.deviceType, device.deviceModel, device.userDefinedDeviceName);
    }
    return this.sensorData[device.deviceID].data;
  }

  private normalizeSensorDate(sensorRoomData) {
    const normalized = [] as any;
    for (const room of sensorRoomData.rooms) {
      normalized[room.id] = [] as any;
      // this.log.debug(room.id);
      for (const sensorAccessory of room.accessories) {
        // this.log.debug(room.id, sensorAccessory.accessoryId);
        sensorAccessory.roomId = room.id;
        normalized[room.id][sensorAccessory.accessoryId] = sensorAccessory;
      }
    }
    // this.log.debug(JSON.stringify(normalized, null, 2));
    return normalized;
  }




  /**
   * this method discovers the firmware Veriosn for T9 Thermostats
   */
  public async getSoftwareRevision(locationId, device) {
    if (device.deviceID.startsWith('LCC') && device.deviceModel.startsWith('T9') && device.groups) {
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(device, group, locationId);
        if (this.config.options ?.roompriority ?.thermostat) {
          this.log.info(`Total Rooms Found: ${roomsensors.length}`);
        }
        for (const accessories of roomsensors) {
          if (accessories) {
            for (const key in accessories) {
              const sensorAccessory = accessories[key];
              if (sensorAccessory.accessoryAttribute && sensorAccessory.accessoryAttribute.type && sensorAccessory.accessoryAttribute.type.startsWith('Thermostat')) {
                this.log.debug('Software Revision', group.id, sensorAccessory.roomId, sensorAccessory.accessoryId, sensorAccessory.accessoryAttribute.name, JSON.stringify(sensorAccessory.accessoryAttribute.softwareRevision));
                return sensorAccessory.accessoryAttribute.softwareRevision;
              } else {
                this.log.info('No Thermostat', device, group, locationId);
              }
            }
          } else {
            this.log.info('No accessories', device, group, locationId);
          }
        }
      }
    } else {
      this.log.info('Not a T9 LCC', device.deviceID.startsWith('LCC'), device.deviceModel.startsWith('T9'), device.groups);
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  private async discoverDevices() {
    if (this.locations) {
      // get the devices at each location
      for (const location of this.locations) {
        // this.log.info(`Getting devices for ${location.name}...`);
        this.log.info(`Total Devices Found at ${location.name}: ${location.devices.length}`);
        const locationId = location.locationID;
        // this.log.debug(location.name, JSON.stringify(location));
        // this.locationinfo(location);
        for (const device of location.devices) {
          if (device.isAlive && device.deviceClass === 'LeakDetector') {
            // this.deviceinfo(device);
            // this.log.debug(JSON.stringify(device));
            this.log.info('Discovered %s - %s', device.deviceType, location.name, device.userDefinedDeviceName);
            this.Leak(device, locationId);
          } else if (device.isAlive && device.deviceClass === 'Thermostat') {
            if (device.deviceID.startsWith('LCC')) {
              if (device.deviceModel.startsWith('T9')) {
                try {
                  this.firmware = await this.getSoftwareRevision(location.locationID, device);
                } catch (e) {
                  this.log.error('Failed to Get T9 Firmware Version.', JSON.stringify(e.message));
                  this.log.debug(JSON.stringify(e));
                }
                // this.deviceinfo(device);
                // this.log.debug(JSON.stringify(device));
                this.log.info('Discovered %s %s - %s', device.deviceType, device.deviceModel, location.name, device.userDefinedDeviceName);
                await this.createT9(device, locationId, this.firmware);
                try {
                  await this.discoverRoomSensors(location.locationID, device);
                } catch (e) {
                  this.log.error('Failed to Find Room Sensors.', JSON.stringify(e.message));
                  this.log.debug(JSON.stringify(e));
                }
              } else if (device.deviceModel.startsWith('T5')) {
                // this.deviceinfo(device);
                // this.log.debug(JSON.stringify(device));
                this.log.info('Discovered %s %s - %s', device.deviceType, device.deviceModel, location.name, device.userDefinedDeviceName);
                this.createT5(device, locationId);
              } else if (device.deviceModel.startsWith('D6')) {
                // this.deviceinfo(device);
                // this.log.debug(JSON.stringify(device));
                this.log.info('Discovered %s %s - %s', device.deviceType, device.deviceModel, location.name, device.userDefinedDeviceName);
                this.createT5(device, locationId);
              } else if (!device.DeviceModel) {
                this.log.info('A LLC Device has been discovered with a deviceModel that does not start with T5, D6 or T9');
              }
            } else if (device.deviceID.startsWith('TCC')) {
              this.log.info('A TCC Device has been discovered, Currently writing to Honeywell API does not work.');
              this.log.info(' Feel free to open an issue on GitHub https://git.io/JURI5');
              if (device.deviceModel.startsWith('Round')) {
                // this.deviceinfo(device);
                // this.log.debug(JSON.stringify(device));
                this.log.info('Discovered %s %s - %s', device.deviceType, device.deviceModel, location.name, device.userDefinedDeviceName);
                this.createRound(device, locationId);
              } else if (device.deviceModel.startsWith('Unknown')) {
                // this.deviceinfo(device);
                // this.log.debug(JSON.stringify(device));
                this.log.info('Discovered %s %s - %s', device.deviceType, device.deviceModel, location.name, device.userDefinedDeviceName);
                this.createTCC(device, locationId);
              } else if (!device.deviceModel) {
                this.log.info(
                  'A TCC Device has been discovered with a deviceModel that does not start with Round or Unknown',
                );
              }
            } else {
              this.log.info(
                'A Device was found that is not supported, ',
                'Please open Feature Request Here: https://git.io/JURLY, ',
                'If you would like to see support.',
              );
            }
          }
        }
      }
    } else {
      this.log.error('Failed to Discover Locations. Re-Link Your Honeywell Home Account.');
    }
  }

  private async discoverRoomSensors(locationId, device) {
    // get the devices at each location
    this.roomsensordisplaymethod();

    if (device.groups) {
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(device, group, locationId);
        // if (roomsensors.rooms) {
        // const rooms = roomsensors.rooms;
        // this.log.error('discoverRoomSensors', JSON.stringify(roomsensors, null, 2));
        //if (this.config.options ?.roompriority ?.thermostat) {
        //  this.log.info(`Total Rooms Found: ${roomsensors.rooms.length}`);
        //}
        for (const accessories of roomsensors) {
          if (accessories) {
            // this.log.debug(JSON.stringify(accessories));
            for (const key in accessories) {
              const sensorAccessory = accessories[key];
              // this.log.debug('sensorAccessory', JSON.stringify(sensorAccessory));
              if (sensorAccessory.accessoryAttribute) {
                if (sensorAccessory.accessoryAttribute.type) {
                  if (sensorAccessory.accessoryAttribute.type.startsWith('IndoorAirSensor')) {
                    // this.log.debug(JSON.stringify(sensorAccessory));
                    // this.log.debug(JSON.stringify(sensorAccessory.accessoryAttribute.name));
                    // this.log.debug(JSON.stringify(sensorAccessory.accessoryAttribute.softwareRevision));
                    this.log.info('Discovered Room Sensor groupId: %s, roomId: %s, accessoryId: %s', group.id, sensorAccessory.roomId, sensorAccessory.accessoryId, sensorAccessory.accessoryAttribute.name);
                    this.createRoomSensors(device, locationId, sensorAccessory, group);
                    this.createRoomSensorThermostat(device, locationId, sensorAccessory, group);
                  }
                }
              }
            }
          }
          //}
        }
      }
    }
  }


  private roomsensordisplaymethod() {
    if (this.config.options ?.roompriority) {
      /**
       * Room Priority
       * This will display what room priority option that has been selected.
       */
      if (this.config.options.roompriority.thermostat) {
        this.log.warn('Displaying Room Sensors as Thermostat(s).');
        this.log.warn('You will have a Thermostat for Each Room Sensor so that you can set the priority of that Room.');
      }
      if (!this.config.options.roompriority.thermostat) {
        this.log.warn('Only Displaying Room Sensors.');
      }
    }
  }

  private async createT9(
    device: T9Thermostat,
    locationId: location['locationID'],
    firmware: accessoryAttribute['softwareRevision'],
  ) {
    const uuid = this.api.hap.uuid.generate(`${device.name}-${device.deviceID}-${device.deviceModel}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.options ?.thermostat ?.hide && device.isAlive) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.firmwareRevision = firmware;
        await this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        await new T9thermostat(this, existingAccessory, locationId, device, firmware);
        this.log.debug(`T9 UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);
      } else if (!device.isAlive || this.config.options ?.thermostat ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.options ?.thermostat ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', `${device.name} ${device.deviceModel} ${device.deviceType}`);
      this.log.debug(
        `Registering new device: ${device.name} ${device.deviceModel} ${device.deviceType} - ${device.deviceID}`,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.name} ${device.deviceType}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.firmwareRevision = firmware;
      accessory.context.device = device;
      // accessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new T9thermostat(this, accessory, locationId, device, firmware);
      this.log.debug(`T9 UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private createT5(device: T5Device, locationId: location['locationID']) {
    const uuid = this.api.hap.uuid.generate(`${device.name}-${device.deviceID}-${device.deviceModel}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.options ?.thermostat ?.hide && device.isAlive) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        //existingAccessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
        //this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new T5thermostat(this, existingAccessory, locationId, device);
        this.log.debug(`T5 UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);
      } else if (!device.isAlive || this.config.options ?.thermostat ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.options ?.thermostat ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', `${device.name} ${device.deviceModel} ${device.deviceType}`);
      this.log.debug(
        `Registering new device: ${device.name} ${device.deviceModel} ${device.deviceType} - ${device.deviceID}`,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.name} ${device.deviceType}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      // accessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new T5thermostat(this, accessory, locationId, device);
      this.log.debug(`T5 UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private createRound(device: RoundDevice, locationId: location['locationID']) {
    const uuid = this.api.hap.uuid.generate(`${device.name}-${device.deviceID}-${device.deviceModel}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.options ?.thermostat ?.hide && device.isAlive) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.firmwareRevision = device.thermostatVersion;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoundThermostat(this, existingAccessory, locationId, device);
        this.log.debug(`Round UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);
      } else if (!device.isAlive || this.config.options ?.thermostat ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.options ?.thermostat ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', `${device.name} ${device.deviceModel} ${device.deviceType}`);
      this.log.debug(
        `Registering new device: ${device.name} ${device.deviceModel} ${device.deviceType} - ${device.deviceID}`,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.name} ${device.deviceType}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.firmwareRevision = device.thermostatVersion;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new RoundThermostat(this, accessory, locationId, device);
      this.log.debug(`Round UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private createTCC(device: TCCDevice, locationId: location['locationID']) {
    const uuid = this.api.hap.uuid.generate(`${device.name}-${device.deviceID}-${device.deviceModel}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.options ?.thermostat ?.hide && device.isAlive) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.firmwareRevision = device.thermostatVersion;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new TCCthermostat(this, existingAccessory, locationId, device);
        this.log.debug(`TCC UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);
      } else if (!device.isAlive || this.config.options ?.thermostat ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.options ?.thermostat ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', `${device.name} TCC(${device.deviceModel}) ${device.deviceType}`);
      this.log.debug(
        `Registering new device: ${device.name} TCC(${device.deviceModel}) ${device.deviceType} - ${device.deviceID}`,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.name} ${device.deviceType}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.firmwareRevision = device.thermostatVersion;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new TCCthermostat(this, accessory, locationId, device);
      this.log.debug(`TCC UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private Leak(device: LeakDevice, locationId: location['locationID']) {
    const uuid = this.api.hap.uuid.generate(`${device.userDefinedDeviceName}-${device.deviceID}-${device.deviceClass}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.options ?.leaksensor ?.hide && device.isAlive) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        //existingAccessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
        //this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LeakSensor(this, existingAccessory, locationId, device);
        this.log.debug(`Leak Sensor UDID: ${device.userDefinedDeviceName}-${device.deviceID}-${device.deviceClass}`);
      } else if (!device.isAlive || this.config.options ?.leaksensor ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.options ?.leaksensor ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', `${device.userDefinedDeviceName}  ${device.deviceClass}`);
      this.log.debug(
        `Registering new device: ${device.userDefinedDeviceName} ${device.deviceClass} - ${device.deviceID}`,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.userDefinedDeviceName} ${device.deviceClass}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      // accessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
      // create the accessory handler for the newly create accessory
      // this is imported from `/Sensors/leakSensors.ts`
      new LeakSensor(this, accessory, locationId, device);
      this.log.debug(`Leak Sensor UDID: ${device.userDefinedDeviceName}-${device.deviceID}-${device.deviceClass}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private createRoomSensors(
    device: T9Thermostat,
    locationId: location['locationID'],
    sensorAccessory: sensorAccessory,
    group: T9groups,
  ) {
    // Room Sensors
    // this.log.info('createRoomSensors', device, locationId, sensorAccessory, group);
    const uuid = this.api.hap.uuid.generate(
      `${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensor`,
    );
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (device.isAlive && !this.config.options ?.roomsensor ?.hide) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        //this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoomSensors(this, existingAccessory, locationId, device, sensorAccessory, group);

      } else if (!device.isAlive || this.config.options ?.roomsensor ?.hide) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (device.isAlive && !this.config.options ?.roomsensor ?.hide) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        `Adding new accessory: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type}`,
      );


      // create a new accessory
      const accessory = new this.api.platformAccessory(
        `${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type}`,
        uuid,
      );

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision;

      // create the accessory handler for the newly create accessory
      // this is imported from `roomSensor.ts`
      new RoomSensors(this, accessory, locationId, device, sensorAccessory, group);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private createRoomSensorThermostat(
    device: T9Thermostat,
    locationId: location['locationID'],
    sensorAccessory: sensorAccessory,
    group: T9groups,
  ) {
    const uuid = this.api.hap.uuid.generate(
      // eslint-disable-next-line max-len
      `${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
    );

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory: { UUID }) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (device.isAlive && this.config.options ?.roompriority ?.thermostat) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision;
        // existingAccessory.context.name = sensorAccessory.accessoryAttribute.name;
        // existingAccessory.context.type = sensorAccessory.accessoryAttribute.type;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoomSensorThermostat(this, existingAccessory, locationId, device, sensorAccessory, group);
        this.log.debug(
          // eslint-disable-next-line max-len
          `Room Sensor Thermostat UDID: ${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
        );
      } else if (!device.isAlive || !this.config.options ?.roompriority ?.thermostat) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (device.isAlive && this.config.options ?.roompriority ?.thermostat) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        'Adding new accessory:',
        `${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Thermostat`,
      );
      this.log.debug(
        'Registering new device: ',
        sensorAccessory.accessoryAttribute.name,
        ' ',
        sensorAccessory.accessoryAttribute.type,
        ' Thermostat - ',
        device.deviceID,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(
        `${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Thermostat`,
        uuid,
      );

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new RoomSensorThermostat(this, accessory, locationId, device, sensorAccessory, group);
      this.log.debug(
        // eslint-disable-next-line max-len
        `Room Sensor Thermostat UDID: ${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
      );

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
  }

  public locationinfo(location: location) {
    if (this.config.devicediscovery) {
      if (location) {
        this.log.warn(JSON.stringify(location));
      }
    }
  }

  public deviceinfo(device: {
    deviceID: string;
    deviceType: string;
    deviceClass: string;
    deviceModel: string;
    priorityType: string;
    settings: Settings;
    inBuiltSensorState: inBuiltSensorState;
    groups: T9Thermostat['groups'];
  }) {
    if (this.config.devicediscovery) {
      this.log.warn(JSON.stringify(device));
      if (device.deviceID) {
        this.log.warn(JSON.stringify(device.deviceID));
        this.log.error(`Device ID: ${device.deviceID}`);
      }
      if (device.deviceType) {
        this.log.warn(JSON.stringify(device.deviceType));
        this.log.error(`Device Type: ${device.deviceType}`);
      }
      if (device.deviceClass) {
        this.log.warn(JSON.stringify(device.deviceClass));
        this.log.error(`Device Class: ${device.deviceClass}`);
      }
      if (device.deviceModel) {
        this.log.warn(JSON.stringify(device.deviceModel));
        this.log.error(`Device Model: ${device.deviceModel}`);
      }
      if (device.priorityType) {
        this.log.warn(JSON.stringify(device.priorityType));
        this.log.error(`Device Priority Type: ${device.priorityType}`);
      }
      if (device.settings) {
        this.log.warn(JSON.stringify(device.settings));
        if (device.settings.fan) {
          this.log.warn(JSON.stringify(device.settings.fan));
          this.log.error(`Device Fan Settings: ${device.settings.fan}`);
          if (device.settings.fan.allowedModes) {
            this.log.warn(JSON.stringify(device.settings.fan.allowedModes));
            this.log.error(`Device Fan Allowed Modes: ${device.settings.fan.allowedModes}`);
          }
          if (device.settings.fan.changeableValues) {
            this.log.warn(JSON.stringify(device.settings.fan.changeableValues));
            this.log.error(`Device Fan Changeable Values: ${device.settings.fan.changeableValues}`);
          }
        }
      }
      if (device.inBuiltSensorState) {
        this.log.warn(JSON.stringify(device.inBuiltSensorState));
        if (device.inBuiltSensorState.roomId) {
          this.log.warn(JSON.stringify(device.inBuiltSensorState.roomId));
          this.log.error(`Device Built In Sensor Room ID: ${device.inBuiltSensorState.roomId}`);
        }
        if (device.inBuiltSensorState.roomName) {
          this.log.warn(JSON.stringify(device.inBuiltSensorState.roomName));
          this.log.error(`Device Built In Sensor Room Name: ${device.inBuiltSensorState.roomName}`);
        }
      }
      if (device.groups) {
        this.log.warn(JSON.stringify(device.groups));

        for (const group of device.groups) {
          this.log.error(`Group: ${group.id}`);
        }
      }
    }
  }
}
