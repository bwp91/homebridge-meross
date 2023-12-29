import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import axios from 'axios';
import storage from 'node-persist';
import httpClient from './connection/http.js';
import deviceTypes from './device/index.js';
import eveService from './fakegato/fakegato-history.js';
import platformConsts from './utils/constants.js';
import platformChars from './utils/custom-chars.js';
import eveChars from './utils/eve-chars.js';
import { generateRandomString, hasProperty, parseError } from './utils/functions.js';
import platformLang from './utils/lang-en.js';

const require = createRequire(import.meta.url);
const plugin = require('../package.json');

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return;
    }

    // Begin plugin initialisation
    try {
      this.api = api;
      this.log = log;
      this.isBeta = plugin.version.includes('beta');
      this.cloudClient = false;
      this.deviceConf = {};
      this.devicesInHB = new Map();
      this.hideChannels = [];
      this.hideMasters = [];
      this.ignoredDevices = [];
      this.localUUIDs = [];

      // Make sure user is running Homebridge v1.4 or above
      if (!api?.versionGreaterOrEqual('1.4.0')) {
        throw new Error(platformLang.hbVersionFail);
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(platformLang.pluginNotConf);
      }

      // Log some environment info for debugging
      this.log(
        '%s v%s | System %s | Node %s | HB v%s | HAPNodeJS v%s...',
        platformLang.initialising,
        plugin.version,
        process.platform,
        process.version,
        api.serverVersion,
        api.hap.HAPLibraryVersion(),
      );

      // Apply the user's configuration
      this.config = platformConsts.defaultConfig;
      this.applyUserConfig(config);

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup());
      this.api.on('shutdown', () => this.pluginShutdown());
    } catch (err) {
      // Catch any errors during initialisation
      const eText = parseError(err, [platformLang.hbVersionFail, platformLang.pluginNotConf]);
      log.warn('***** %s. *****', platformLang.disabling);
      log.warn('***** %s. *****', eText);
    }
  }

  applyUserConfig(config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgDef, def);
    };
    const logDuplicate = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgDup);
    };
    const logIgnore = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgn);
    };
    const logIgnoreItem = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgnItem);
    };
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgLow, min);
    };
    const logQuotes = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgQts);
    };
    const logRemove = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgRmv);
    };

    // Begin applying the user's config
    Object.entries(config).forEach((entry) => {
      const [key, val] = entry;
      switch (key) {
        case 'babyDevices':
        case 'diffuserDevices':
        case 'fanDevices':
        case 'garageDevices':
        case 'humidifierDevices':
        case 'lightDevices':
        case 'multiDevices':
        case 'purifierDevices':
        case 'rollerDevices':
        case 'sensorDevices':
        case 'singleDevices':
        case 'thermostatDevices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((x) => {
              if (
                !(
                  x.serialNumber
                  && x.name
                  && x.deviceUrl
                  && (x.connection === 'local' || ((config.connection === 'local' || config.userkey) && x.model))
                )
              ) {
                logIgnoreItem(key);
                return;
              }
              const id = x.serialNumber.toLowerCase().replace(/[^a-z\d]+/g, '');
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(`${key}.${id}`);
                return;
              }
              const entries = Object.entries(x);
              if (entries.length === 1) {
                logRemove(`${key}.${id}`);
                return;
              }
              this.deviceConf[id] = {};
              entries.forEach((subEntry) => {
                const [k, v] = subEntry;
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'garageDoorOpeningTime':
                  case 'inUsePowerThreshold':
                  case 'lowBattThreshold': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`);
                    }
                    const intVal = parseInt(v, 10);
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k]);
                      this.deviceConf[id][k] = platformConsts.defaultValues[k];
                    } else if (intVal < platformConsts.minValues[k]) {
                      logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k]);
                      this.deviceConf[id][k] = platformConsts.minValues[k];
                    } else {
                      this.deviceConf[id][k] = intVal;
                    }
                    break;
                  }
                  case 'connection':
                  case 'showAs': {
                    const inSet = platformConsts.allowed[k].includes(v);
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(`${key}.${id}.${k}`);
                    } else {
                      this.deviceConf[id][k] = v === 'default' ? platformConsts.defaultValues[k] : v;
                    }
                    break;
                  }
                  case 'deviceUrl':
                  case 'firmwareRevision':
                  case 'ignoreSubdevices':
                  case 'model':
                  case 'name':
                  case 'serialNumber':
                  case 'temperatureSource':
                  case 'userkey':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`);
                    } else {
                      this.deviceConf[id][k] = v.trim();
                      if (k === 'deviceUrl') {
                        this.localUUIDs.push(id);
                      }
                    }
                    break;
                  case 'hideChannels': {
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`);
                    } else {
                      const channels = v.split(',');
                      channels.forEach((channel) => {
                        this.hideChannels.push(id + channel.replace(/\D+/g, ''));
                        this.deviceConf[id][k] = v;
                      });
                    }
                    break;
                  }
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`);
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id);
                    }
                    break;
                  case 'reversePolarity':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`);
                    }
                    this.deviceConf[id][k] = v === 'false' ? false : !!v;
                    break;
                  default:
                    logRemove(`${key}.${id}.${k}`);
                }
              });
            });
          } else {
            logIgnore(key);
          }
          break;
        case 'cloudRefreshRate':
        case 'refreshRate': {
          if (typeof val === 'string') {
            logQuotes(key);
          }
          const intVal = parseInt(val, 10);
          if (Number.isNaN(intVal)) {
            logDefault(key, platformConsts.defaultValues[key]);
          } else if (intVal !== 0 && intVal < platformConsts.minValues[key]) {
            logIncrease(key, platformConsts.minValues[key]);
          } else if (intVal === 0 || intVal > 600) {
            this.config[key] = 600;
          } else {
            this.config[key] = intVal;
          }
          break;
        }
        case 'connection': {
          const inSet = platformConsts.allowed[key].includes(val);
          if (typeof val !== 'string' || !inSet) {
            logIgnore(key);
          } else {
            this.config[key] = val === 'default' ? platformConsts.defaultValues[key] : val;
          }
          break;
        }
        case 'disableDeviceLogging':
        case 'ignoreHKNative':
        case 'ignoreMatter':
        case 'showUserKey':
          if (typeof val === 'string') {
            logQuotes(key);
          }
          this.config[key] = val === 'false' ? false : !!val;
          break;
        case 'domain':
        case 'mfaCode':
        case 'password':
        case 'username':
          if (typeof val !== 'string') {
            logIgnore(key);
          } else {
            this.config[key] = val;
          }
          break;
        case 'name':
        case 'platform':
          break;
        case 'userkey':
          if (typeof val !== 'string') {
            logIgnore(key);
          } else {
            const userkey = val.toLowerCase().replace(/[^a-z\d]+/g, '');
            if (userkey.length === 32) {
              this.config[key] = userkey;
            } else {
              logIgnore(key);
            }
          }
          break;
        default:
          logRemove(key);
          break;
      }
    });
  }

  async pluginSetup() {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', platformLang.initialised);

      // Sort out some logging functions
      if (this.isBeta) {
        this.log.debug = this.log;
        this.log.debugWarn = this.log.warn;

        // Log that using a beta will generate a lot of debug logs
        if (this.isBeta) {
          const divide = '*'.repeat(platformLang.beta.length + 1); // don't forget the full stop (+1!)
          this.log.warn(divide);
          this.log.warn(`${platformLang.beta}.`);
          this.log.warn(divide);
        }
      } else {
        this.log.debug = () => {};
        this.log.debugWarn = () => {};
      }

      // Require any libraries that the accessory instances use
      this.cusChar = new platformChars(this.api);
      this.eveChar = new eveChars(this.api);
      this.eveService = eveService(this.api);

      const cachePath = join(this.api.user.storagePath(), '/bwp91_cache');

      // Create folders if they don't exist
      if (!existsSync(cachePath)) {
        mkdirSync(cachePath);
      }

      // Persist files are used to store device info that can be used by my other plugins
      try {
        this.storageData = storage.create({
          dir: cachePath,
          forgiveParseErrors: true,
        });
        await this.storageData.init();
        this.storageClientData = true;
      } catch (err) {
        this.log.debugWarn('%s %s.', platformLang.storageSetupErr, parseError(err));
      }

      // If the user has configured cloud username and password then get a device list
      this.accountDetails = {};
      let cloudDevices = [];
      try {
        if (!this.config.username || !this.config.password) {
          throw new Error(platformLang.missingCreds);
        }

        // Try and get token from the cache to get a device list
        try {
          const storedData = await this.storageData.getItem('Meross_All_Devices_temp');
          const splitData = storedData?.split(':::');
          if (!Array.isArray(splitData) || splitData.length !== 4) {
            throw new Error(platformLang.accTokenNoExist);
          }
          if (splitData[0] !== this.config.username) {
            // Username has changed so throw error to generate new token
            throw new Error(platformLang.accTokenUserChange);
          }

          this.accountDetails.key = splitData[1]; // eslint-disable-line prefer-destructuring
          this.accountDetails.token = splitData[2]; // eslint-disable-line prefer-destructuring
          this.accountDetails.userId = splitData[3]; // eslint-disable-line prefer-destructuring

          this.log.debug('[HTTP] %s.', platformLang.accTokenFromCache);

          this.cloudClient = new httpClient(this);
        } catch (err) {
          this.log.warn('[HTTP] %s %s.', platformLang.accTokenFail, parseError(err, [
            platformLang.accTokenUserChange,
            platformLang.accTokenNoExist,
          ]));

          this.cloudClient = new httpClient(this);
          this.accountDetails = await this.cloudClient.login();
        }

        // Initialise the cloud configured devices into Homebridge
        cloudDevices = await this.cloudClient.getDevices();
        cloudDevices.forEach((device) => this.initialiseDevice(device));
      } catch (err) {
        const eText = parseError(err, [platformLang.mfaFail, platformLang.missingCreds]);
        this.log.warn('%s %s.', platformLang.disablingCloud, eText);
        this.cloudClient = false;
        this.accountDetails = {
          key: this.config.userkey,
        };
      }

      // Check if a user key has been configured if the credentials aren't present
      if (!this.cloudClient) {
        if (this.config.userkey) {
          // Initialise the local configured devices into Homebridge
          Object.values(this.deviceConf)
            .filter((el) => el.deviceUrl)
            .forEach((device) => {
              // Ensure we have a model property if a user key is configured, and credentials are not
              if (!this.config.username && this.config.userkey && !device.model) {
                this.log.warn('[%s] %s.', device.name, platformLang.missingModal);
                return;
              }

              // Rename some properties to fit the format of a cloud device
              // Local devices don't have the uuid already set
              device.uuid = device.serialNumber;
              device.deviceType = device.model.toUpperCase().replace(/-+/g, '');
              device.devName = device.name;
              device.channels = [];

              // Retrieve how many channels this device has
              const garageCount = device.deviceType === 'MSG200' ? 3 : 1;
              const channelCount = platformConsts.models.switchMulti[device.deviceType] || garageCount;

              // Create a list of channels to fit the format of a cloud device
              if (channelCount > 1) {
                for (let index = 0; index <= channelCount; index += 1) {
                  device.channels.push({});
                }
              }
              this.initialiseDevice(device);
            });
        } else {
          // Cloud client disabled and no user key - plugin will be useless
          throw new Error(platformLang.noCredentials);
        }
      }

      // Check for redundant accessories or those that have been ignored but exist
      this.devicesInHB.forEach((accessory) => {
        switch (accessory.context.connection) {
          case 'cloud':
          case 'hybrid':
            if (!cloudDevices.some((el) => el.uuid === accessory.context.serialNumber)) {
              this.removeAccessory(accessory);
            }
            break;
          case 'local':
            if (!this.localUUIDs.includes(accessory.context.serialNumber)) {
              this.removeAccessory(accessory);
            }
            break;
          default:
            // Should never happen
            this.removeAccessory(accessory);
            break;
        }
      });

      // Setup successful
      this.log('%s. %s', platformLang.complete, platformLang.welcome);
    } catch (err) {
      // Catch any errors during setup
      const eText = parseError(err, [platformLang.noCredentials]);
      this.log.warn('***** %s. *****', platformLang.disabling);
      this.log.warn('***** %s. *****', eText);
      this.pluginShutdown();
    }
  }

  pluginShutdown() {
    // A function that is called when the plugin fails to load or Homebridge restarts
    try {
      // Close the mqtt connection for the accessories with an open connection
      if (this.cloudClient) {
        this.devicesInHB.forEach((accessory) => {
          if (accessory.mqtt) {
            accessory.mqtt.disconnect();
          }
          if (accessory.refreshInterval) {
            clearInterval(accessory.refreshInterval);
          }
          if (accessory.powerInterval) {
            clearInterval(accessory.powerInterval);
          }
        });
      }
    } catch (err) {
      // No need to show errors at this point
    }
  }

  applyAccessoryLogging(accessory) {
    if (this.isBeta) {
      accessory.log = (msg) => this.log('[%s] %s.', accessory.displayName, msg);
      accessory.logWarn = (msg) => this.log.warn('[%s] %s.', accessory.displayName, msg);
      accessory.logDebug = (msg) => this.log('[%s] %s.', accessory.displayName, msg);
      accessory.logDebugWarn = (msg) => this.log.warn('[%s] %s.', accessory.displayName, msg);
    } else {
      if (this.config.disableDeviceLogging) {
        accessory.log = () => {};
        accessory.logWarn = () => {};
      } else {
        accessory.log = (msg) => this.log('[%s] %s.', accessory.displayName, msg);
        accessory.logWarn = (msg) => this.log.warn('[%s] %s.', accessory.displayName, msg);
      }
      accessory.logDebug = () => {};
      accessory.logDebugWarn = () => {};
    }
  }

  async initialiseDevice(device) {
    try {
      // Get any user configured entry for this device
      const deviceConf = this.deviceConf[device.uuid.toLowerCase()] || {};

      // Generate a unique id for the accessory
      const hbUUID = this.api.hap.uuid.generate(device.uuid);
      device.firmware = deviceConf.firmwareRevision || device.fmwareVersion;
      device.hbDeviceId = device.uuid;
      device.model = device.deviceType.toUpperCase().replace(/-+/g, '');

      // Add context information for the plugin-ui and instance to use
      const context = {
        channel: 0,
        channelCount: device.channels.length,
        connection: deviceConf.deviceUrl
          ? 'local'
          : deviceConf.connection || this.config.connection,
        deviceUrl: deviceConf.deviceUrl,
        domain: device.domain,
        firmware: device.firmware,
        hidden: false,
        isOnline: false,
        model: device.model,
        options: deviceConf,
        serialNumber: device.uuid,
        userkey: deviceConf.userkey || this.accountDetails.key,
      };

      // Find the correct instance determined by the device model
      let accessory;
      if (platformConsts.models.switchSingle.includes(device.model)) {
        /** **************
         SWITCHES (SINGLE)
         *************** */
        // Set up the accessory and instance
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        switch (deviceConf.showAs) {
          case 'cooler':
            accessory.control = new deviceTypes.deviceCoolerSingle(this, accessory);
            break;
          case 'heater':
            accessory.control = new deviceTypes.deviceHeaterSingle(this, accessory);
            break;
          case 'outlet':
            accessory.control = new deviceTypes.deviceOutletSingle(this, accessory);
            break;
          case 'purifier':
            accessory.control = new deviceTypes.devicePurifierSingle(this, accessory);
            break;
          default:
            accessory.control = new deviceTypes.deviceSwitchSingle(this, accessory);
        }
        /** ************ */
      } else if (hasProperty(platformConsts.models.switchMulti, device.model)) {
        /** *************
         SWITCHES (MULTI)
         ************** */
        // Loop through the channels
        device.channels.forEach((channel, index) => {
          const subdeviceObj = { ...device };
          const extraContext = {};

          // Generate the Homebridge UUID from the device uuid and channel index
          const uuidSub = device.uuid + index;
          subdeviceObj.hbDeviceId = uuidSub;
          const hbUUIDSub = this.api.hap.uuid.generate(uuidSub);

          // Supply a device name for the channel accessories
          if (index > 0) {
            subdeviceObj.devName = channel.devName || `${device.devName} SW${index}`;
          }

          // Check if the user has chosen to hide any channels for this device
          let subAcc;
          if (this.hideChannels.includes(device.uuid + index)) {
            // The user has hidden this channel so if it exists then remove it
            if (this.devicesInHB.has(hbUUIDSub)) {
              this.removeAccessory(this.devicesInHB.get(hbUUIDSub));
            }

            // If this is the main channel then add it to the array of hidden masters
            if (index === 0) {
              this.hideMasters.push(device.uuid);

              // Add the sub accessory, but hidden, to Homebridge
              extraContext.hidden = true;
              subAcc = this.addAccessory(subdeviceObj, true);
            } else {
              return;
            }
          } else {
            // The user has not hidden this channel
            subAcc = this.devicesInHB.get(hbUUIDSub) || this.addAccessory(subdeviceObj);
          }

          // Add the context information to the accessory
          extraContext.channel = index;
          subAcc.context = { ...subAcc.context, ...context, ...extraContext };
          this.applyAccessoryLogging(subAcc);

          // Create the device type instance for this accessory
          switch (deviceConf.showAs) {
            case 'outlet':
              subAcc.control = new deviceTypes.deviceOutletMulti(this, subAcc);
              break;
            default:
              subAcc.control = new deviceTypes.deviceSwitchMulti(this, subAcc);
              break;
          }

          // This is used for later in this function for logging
          if (index === 0) {
            accessory = subAcc;
          } else {
            // Update any changes to the accessory to the platform
            this.api.updatePlatformAccessories([subAcc]);
            this.devicesInHB.set(subAcc.UUID, subAcc);
          }
        });
        /** *********** */
      } else if (platformConsts.models.lightDimmer.includes(device.model)) {
        /** ************
         LIGHTS (DIMMER)
         ************* */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceLightDimmer(this, accessory);
        /** ********** */
      } else if (platformConsts.models.lightRGB.includes(device.model)) {
        /** *********
         LIGHTS (RGB)
         ********** */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceLightRGB(this, accessory);
        /** ******* */
      } else if (platformConsts.models.lightCCT.includes(device.model)) {
        /** *********
         LIGHTS (CCT)
         ********** */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceLightCCT(this, accessory);
        /** ******* */
      } else if (platformConsts.models.garage.includes(device.model)) {
        /** *********
         GARAGE DOORS
         ********** */
        if (device.model === 'MSG200') {
          // If a main accessory exists from before then remove it so re-added as hidden
          if (this.devicesInHB.has(hbUUID)) {
            this.removeAccessory(this.devicesInHB.get(hbUUID));
          }

          // First, set up the main, hidden, accessory that will process the control and updates
          accessory = this.addAccessory(device, true);
          accessory.context = { ...accessory.context, ...context, ...{ hidden: true } };
          this.applyAccessoryLogging(accessory);
          accessory.control = new deviceTypes.deviceGarageMain(this, accessory);

          // Loop through the channels
          device.channels.forEach((channel, index) => {
            // Skip the channel 0 entry
            if (index === 0) {
              return;
            }
            const subdeviceObj = { ...device };
            const extraContext = {};

            // Generate the Homebridge UUID from the device uuid and channel index
            const uuidSub = device.uuid + index;
            subdeviceObj.hbDeviceId = uuidSub;
            const hbUUIDSub = this.api.hap.uuid.generate(uuidSub);

            // Supply a device name for the channel accessories
            if (index > 0) {
              device.devName = channel.devName || `${device.devName} SW${index}`;
            }

            // Check if the user has chosen to hide any channels for this device
            if (this.hideChannels.includes(device.uuid + index)) {
              // The user has hidden this channel so if it exists then remove it
              if (this.devicesInHB.has(hbUUIDSub)) {
                this.removeAccessory(this.devicesInHB.get(hbUUIDSub));
              }
              return;
            }

            // The user has not hidden this channel
            const subAcc = this.devicesInHB.get(hbUUIDSub) || this.addAccessory(subdeviceObj);

            // Add the context information to the accessory
            extraContext.channel = index;
            subAcc.context = { ...subAcc.context, ...context, ...extraContext };
            this.applyAccessoryLogging(subAcc);

            // Create the device type instance for this accessory
            subAcc.control = new deviceTypes.deviceGarageSub(this, subAcc, accessory);

            // Update any changes to the accessory to the platform
            this.api.updatePlatformAccessories([subAcc]);
            this.devicesInHB.set(subAcc.UUID, subAcc);
          });
        } else {
          accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
          accessory.context = { ...accessory.context, ...context };
          this.applyAccessoryLogging(accessory);
          accessory.control = new deviceTypes.deviceGarageSingle(this, accessory);
        }
        /** ******* */
      } else if (platformConsts.models.roller.includes(device.model)) {
        /** ***********
         ROLLING MOTORS
         ************ */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = ['6.0.0', '7.0.0', '8.0.0'].includes(device.hdwareVersion)
          ? new deviceTypes.deviceRollerLocation(this, accessory)
          : new deviceTypes.deviceRoller(this, accessory);
        /** ******** */
      } else if (platformConsts.models.purifier.includes(device.model)) {
        /** ******
         PURIFIERS
         ******* */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.devicePurifier(this, accessory);
        /** *** */
      } else if (platformConsts.models.fan.includes(device.model)) {
        /** *
         FANS
         ** */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceFan(this, accessory);
        /** *** */
      } else if (platformConsts.models.diffuser.includes(device.model)) {
        /** ******
         DIFFUSERS
         ******* */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceDiffuser(this, accessory);
        /** *** */
      } else if (platformConsts.models.humidifier.includes(device.model)) {
        /** ********
         HUMIDIFIERS
         ********* */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceHumidifier(this, accessory);
        /** *** */
      } else if (platformConsts.models.baby.includes(device.model)) {
        /** **********
         BABY MONITORS
         *********** */
        accessory = this.addExternalAccessory(device, 26);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);

        // Create a second accessory for the baby light
        const deviceLightHBID = `${device.uuid}_light`;
        const deviceLightHBUUID = this.api.hap.uuid.generate(deviceLightHBID);
        const deviceLight = {
          ...device,
          hbDeviceId: deviceLightHBID,
        };
        const accessoryLight = this.devicesInHB.get(deviceLightHBUUID) || this.addAccessory(deviceLight);
        accessoryLight.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessoryLight);

        // Update any changes to the accessory to the platform
        this.api.updatePlatformAccessories([accessoryLight]);
        this.devicesInHB.set(accessoryLight.UUID, accessoryLight);

        // Set up the main accessory for the baby monitor
        accessory.control = new deviceTypes.deviceBaby(this, accessory, accessoryLight);
        /** ******* */
      } else if (platformConsts.models.thermostat.includes(device.model)) {
        /** ********
         THERMOSTATS
         ********* */
        accessory = this.devicesInHB.get(hbUUID) || this.addAccessory(device);
        accessory.context = { ...accessory.context, ...context };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceThermostat(this, accessory);
        /** ***** */
      } else if (platformConsts.models.hubMain.includes(device.model)) {
        /** ********
         SENSOR HUBS
         ********* */
        // At the moment, cloud connection is necessary to get a subdevice list
        if (!this.cloudClient) {
          throw new Error(platformLang.sensorNoCloud);
        }

        // Obtain array of any subdevices to ignore
        const subdevicesToIgnore = [];
        if (context.options.ignoreSubdevices) {
          context.options.ignoreSubdevices
            .split(',')
            .forEach((subdeviceId) => subdevicesToIgnore.push(subdeviceId.trim()));
        }
        context.ignoreSubdevices = subdevicesToIgnore;

        // First, set up the main, hidden, accessory that will process the incoming updates
        accessory = this.addAccessory(device, true);
        accessory.context = { ...accessory.context, ...context, ...{ hidden: true } };
        this.applyAccessoryLogging(accessory);
        accessory.control = new deviceTypes.deviceHubMain(this, accessory);

        // Then request and initialise a list of subdevices
        const subdevices = await this.cloudClient.getSubDevices(device);
        if (!Array.isArray(subdevices)) {
          throw new Error(platformLang.sensorNoSubs);
        }

        // Initialise subdevices into HB
        subdevices.forEach((subdevice) => {
          try {
            // Create an object to mimic the addAccessory data
            const subdeviceObj = { ...device };
            const uuidSub = device.uuid + subdevice.subDeviceId;
            const hbUUIDSub = this.api.hap.uuid.generate(uuidSub);

            // Check if it's ignored device
            if (subdevicesToIgnore.includes(subdevice.subDeviceId)) {
              // Is ignored, remove if exists
              if (this.devicesInHB.has(hbUUIDSub)) {
                this.removeAccessory(this.devicesInHB.get(hbUUIDSub));
              }
              return;
            }

            // Not ignored, so continue initialising
            subdeviceObj.devName = subdevice.subDeviceName || subdevice.subDeviceId;
            subdeviceObj.hbDeviceId = uuidSub;
            subdeviceObj.model = subdevice.subDeviceType.toUpperCase().replace(/-+/g, '');

            // Check the subdevice model is supported
            if (!platformConsts.models.hubSub.includes(subdeviceObj.model)) {
              // Not supported, so show a log message with helpful info for a GitHub issue
              this.log.warn(
                '[%s] %s:\n%s',
                subdeviceObj.devName,
                platformLang.notSupp,
                JSON.stringify(subdeviceObj),
              );
              return;
            }

            // Obtain or add this subdevice to Homebridge
            const subAcc = this.devicesInHB.get(hbUUIDSub) || this.addAccessory(subdeviceObj);

            // Add helpful context info to the accessory object
            subAcc.context = {
              ...subAcc.context,
              ...context,
              ...{ subSerialNumber: subdevice.subDeviceId },
            };
            this.applyAccessoryLogging(subAcc);

            // Create the device type instance for this accessory
            switch (subdeviceObj.model) {
              case 'GS559A':
                subAcc.control = new deviceTypes.deviceHubSmoke(this, subAcc);
                break;
              case 'MS100':
                subAcc.control = new deviceTypes.deviceHubSensor(this, subAcc);
                break;
              case 'MS400':
                subAcc.control = new deviceTypes.deviceHubLeak(this, subAcc);
                break;
              case 'MTS100V3':
              case 'MTS150':
                subAcc.control = new deviceTypes.deviceHubValve(this, subAcc, accessory);
                break;
              default:
                return;
            }

            // Update any changes to the accessory to the platform
            this.api.updatePlatformAccessories([subAcc]);
            this.devicesInHB.set(subAcc.UUID, subAcc);

            // Log the subdevice id so a user can use it to ignore device if wanted
            this.log(
              '[%s] [%s] %s [%s].',
              device.devName,
              subdeviceObj.devName,
              platformLang.devSubInit,
              subdevice.subDeviceId,
            );
          } catch (err) {
            this.log.warn('[%s] %s %s.', subdevice.subDeviceName, platformLang.devNotAdd, parseError(err));
          }
        });
        /** ****** */
      } else {
        /** *************
         UNSUPPORTED YET
         ************* */
        this.log.warn('[%s] %s:\n%s', device.devName, platformLang.notSupp, JSON.stringify(device));
        return;
        /** **************** */
      }

      // Log the device initialisation
      accessory.log(`${platformLang.devInit} [${device.uuid}}]`);

      // Extra debug logging when set, show the device JSON info
      accessory.logDebug(`${platformLang.jsonInfo}: ${JSON.stringify(device)}`);

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories([accessory]);
      this.devicesInHB.set(accessory.UUID, accessory);
    } catch (err) {
      // Catch any errors during device initialisation
      const eText = parseError(err, [
        platformLang.accNotFound,
        platformLang.sensorNoCloud,
        platformLang.sensorNoSubs,
      ]);
      this.log.warn('[%s] %s %s.', device.devName, platformLang.devNotInit, eText);
    }
  }

  addAccessory(device, hidden = false) {
    // Add an accessory to Homebridge
    try {
      const accessory = new this.api.platformAccessory(
        device.devName,
        this.api.hap.uuid.generate(device.hbDeviceId),
      );

      // If it isn't a hidden device then set the accessory characteristics
      if (!hidden) {
        accessory
          .getService(this.api.hap.Service.AccessoryInformation)
          .setCharacteristic(this.api.hap.Characteristic.Name, device.devName)
          .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.devName)
          .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.uuid)
          .setCharacteristic(this.api.hap.Characteristic.Manufacturer, platformLang.brand)
          .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
          .setCharacteristic(
            this.api.hap.Characteristic.FirmwareRevision,
            device.firmware || plugin.version,
          )
          .setCharacteristic(this.api.hap.Characteristic.Identify, true);

        // Register the accessory if it hasn't been hidden by the user
        this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory]);
        this.log('[%s] %s.', device.devName, platformLang.devAdd);
      }

      // Configure for good practice
      this.configureAccessory(accessory);

      // Return the new accessory
      return accessory;
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', device.devName, platformLang.devNotAdd, parseError(err));
      return false;
    }
  }

  addExternalAccessory(device, category) {
    try {
      // Add the new accessory to Homebridge
      const accessory = new this.api.platformAccessory(
        device.devName,
        this.api.hap.uuid.generate(device.hbDeviceId),
        category,
      );

      // Set the accessory characteristics
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Name, device.devName)
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.devName)
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.uuid)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, platformLang.brand)
        .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
        .setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          device.firmware || plugin.version,
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true);

      // Register the accessory
      this.api.publishExternalAccessories(plugin.name, [accessory]);
      this.log('[%s] %s.', device.devName, platformLang.devAdd);

      // Return the new accessory
      this.configureAccessory(accessory);
      return accessory;
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', device.name, platformLang.devNotAdd, parseError(err));
      return false;
    }
  }

  configureAccessory(accessory) {
    // Set the correct firmware version if we can
    if (this.api && accessory.context.firmware) {
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .updateCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          accessory.context.firmware,
        );
    }

    // Add the configured accessory to our global map
    this.devicesInHB.set(accessory.UUID, accessory);
  }

  updateAccessory(accessory) {
    this.api.updatePlatformAccessories([accessory]);
    if (accessory.context.isOnline) {
      this.log('[%s] %s.', accessory.displayName, platformLang.repOnline);
    } else {
      this.log.warn('[%s] %s.', accessory.displayName, platformLang.repOffline);
    }
  }

  removeAccessory(accessory) {
    try {
      // Remove an accessory from Homebridge
      if (!accessory.context.hidden) {
        this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory]);
      }
      this.devicesInHB.delete(accessory.UUID);
      this.log('[%s] %s.', accessory.displayName, platformLang.devRemove);
    } catch (err) {
      // Catch any errors during remove
      this.log.warn('[%s] %s %s.', accessory.displayName, platformLang.devNotRemove, parseError(err));
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async sendUpdate(accessory, toSend) {
    // Variable res is the response from either the cloud mqtt update or local http request
    let res;

    // Generate the method variable determined from an empty payload or not
    toSend.method = toSend.method || (Object.keys(toSend.payload).length === 0 ? 'GET' : 'SET');

    // Always try local control first, even for cloud devices
    try {
      // Check the user has this mode turned on
      if (accessory.context.connection === 'cloud') {
        throw new Error(platformLang.noHybridMode);
      }

      // Check we have the user key
      if (!accessory.context.userkey) {
        throw new Error(platformLang.noUserKey);
      }

      // Certain models aren't supported for local control
      if (platformConsts.noLocalControl.includes(accessory.context.model)) {
        throw new Error(platformLang.notSuppLocal);
      }

      // Obtain the IP address, either manually configured or from Meross polling data
      const ipAddress = accessory.context.deviceUrl || accessory.context.ipAddress;

      // Check the IP address exists
      if (!ipAddress) {
        throw new Error(platformLang.noIP);
      }

      // Generate the timestamp, messageId and sign from the userkey
      const timestamp = Math.floor(Date.now() / 1000);
      const messageId = generateRandomString(32);
      const sign = createHash('md5')
        .update(messageId + accessory.context.userkey + timestamp)
        .digest('hex');

      // Generate the payload to send
      const data = {
        header: {
          from: `http://${ipAddress}/config`,
          messageId,
          method: toSend.method,
          namespace: toSend.namespace,
          payloadVersion: 1,
          sign,
          timestamp,
          triggerSrc: 'iOSLocal',
          uuid: accessory.context.serialNumber,
        },
        payload: toSend.payload || {},
      };

      // Log the update if user enabled
      accessory.logDebug(`${platformLang.sendUpdate}: ${JSON.stringify(data)}`);

      // Send the request to the device
      res = await axios({
        url: `http://${ipAddress}/config`,
        method: 'post',
        headers: { 'content-type': 'application/json' },
        data,
        responseType: 'json',
        timeout: toSend.method === 'GET' || accessory.context.connection === 'local' ? 9000 : 4000,
      });

      // Check the response properties based on whether it is a control or request update
      switch (toSend.method) {
        case 'SET': {
          // Check the response
          if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
            throw new Error(`${platformLang.reqFail} - ${JSON.stringify(res.data.payload.error)}`);
          }
          break;
        }
        default: { // GET
          // Validate the response, checking for payload property
          if (!res.data || !res.data.payload) {
            throw new Error(platformLang.invalidResponse);
          }

          // Check we are sending the command to the correct device
          if (
            res.data.header.from
            !== `/appliance/${accessory.context.serialNumber}/publish`
          ) {
            throw new Error(platformLang.wrongDevice);
          }
          break;
        }
      }
    } catch (err) {
      if (accessory.context.connection === 'local') {
        // An error occurred and cloud mode is disabled so report the error back
        throw err;
      } else {
        // An error occurred, so we can try sending the request via the cloud
        const eText = parseError(err, [
          platformLang.noHybridMode,
          platformLang.notSuppLocal,
          platformLang.noUserKey,
          platformLang.noIP,
          platformLang.wrongDevice,
        ]);
        accessory.logDebug(`${platformLang.revertToCloud} ${eText}`);

        // Send the update via cloud mqtt
        res = await accessory.mqtt.sendUpdate(accessory, toSend);
      }
    }

    // Return the response
    return res;
  }
}
