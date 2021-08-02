/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

// Packages and constant variables for this class
const axios = require('axios')
const crypto = require('crypto')
const devicesInHB = new Map()
const plugin = require('./../package.json')

// Variables for this class to use later
let cloudClient = false

// Create the platform class
class MerossPlatform {
  constructor (log, config, api) {
    // Don't load the plugin if these aren't accessible for any reason
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.consts = require('./utils/constants')
      this.funcs = require('./utils/functions')
      this.log = log

      // Configuration objects for accessories
      this.deviceConf = {}
      this.hideChannels = []
      this.hideMasters = []
      this.ignoredDevices = []
      this.localUUIDs = []

      // Retrieve the user's chosen language file
      this.lang = require('./utils/lang-en')

      // Make sure user is running Homebridge v1.3 or above
      if (!api.versionGreaterOrEqual || !api.versionGreaterOrEqual('1.3.0')) {
        throw new Error(this.lang.hbVersionFail)
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(this.lang.pluginNotConf)
      }

      // Log some environment info for debugging
      this.log(
        '%s v%s | Node %s | HB v%s%s...',
        this.lang.initialising,
        plugin.version,
        process.version,
        api.serverVersion,
        config.plugin_map
          ? ' | HOOBS v3'
          : require('os')
              .hostname()
              .includes('hoobs')
          ? ' | HOOBS v4'
          : ''
      )

      // Apply the user's configuration
      this.config = this.consts.defaultConfig
      this.applyUserConfig(config)

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      const eText = this.funcs.parseError(err, [this.lang.hbVersionFail, this.lang.pluginNotConf])
      log.warn('***** %s. *****', this.lang.disabling)
      log.warn('***** %s. *****', eText)
    }
  }

  applyUserConfig (config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgDef, def)
    }
    const logDuplicate = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgDup)
    }
    const logIgnore = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgn)
    }
    const logIgnoreItem = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgnItem)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgLow, min)
    }
    const logQuotes = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgQts)
    }
    const logRemove = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgRmv)
    }

    // Begin applying the user's config
    for (const [key, val] of Object.entries(config)) {
      switch (key) {
        case 'cloudRefreshRate':
        case 'refreshRate': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const intVal = parseInt(val)
          if (isNaN(intVal)) {
            logDefault(key, this.consts.defaultValues[key])
          } else if (intVal !== 0 && intVal < this.consts.minValues[key]) {
            logIncrease(key, this.consts.minValues[key])
          } else {
            this.config[key] = intVal
          }
          break
        }
        case 'debug':
        case 'disableDeviceLogging':
        case 'disablePlugin':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'devices':
        case 'diffuserDevices':
        case 'garageDevices':
        case 'lightDevices':
        case 'multiDevices':
        case 'rollerDevices':
        case 'sensorDevices':
        case 'singleDevices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber || !x.name || !x.model) {
                logIgnoreItem(key)
                return
              }
              const id = x.serialNumber.toLowerCase().replace(/[^a-z0-9]+/g, '')
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(key + '.' + id)
                return
              }
              if (key === 'devices') {
                this.log.warn('[%s] %s.', id, this.lang.cfgMoveEntry)
              }
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(key + '.' + id)
                return
              }
              this.deviceConf[id] = {}
              for (const [k, v] of entries) {
                if (!this.consts.allowed[key].includes(k)) {
                  logRemove(key + '.' + id + '.' + k)
                  continue
                }
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'garageDoorOpeningTime':
                  case 'inUsePowerThreshold': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + id + '.' + k, this.consts.defaultValues[k])
                      this.deviceConf[id][k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + id + '.' + k, this.consts.minValues[k])
                      this.deviceConf[id][k] = this.consts.minValues[k]
                    } else {
                      this.deviceConf[id][k] = intVal
                    }
                    break
                  }
                  case 'overrideLogging':
                  case 'showAs': {
                    const inSet = this.consts.allowed[k].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      this.deviceConf[id][k] = inSet ? v : this.consts.defaultValues[k]
                    }
                    break
                  }
                  case 'deviceUrl':
                  case 'firmwareRevision':
                  case 'model':
                  case 'name':
                  case 'serialNumber':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      this.deviceConf[id][k] = v
                      if (k === 'deviceUrl') {
                        this.localUUIDs.push(id)
                      }
                    }
                    break
                  case 'hideChannels': {
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      const channels = v.split(',')
                      channels.forEach(channel => {
                        this.hideChannels.push(id + channel.replace(/[^0-9]+/g, ''))
                        this.deviceConf[id][k] = v
                      })
                    }
                    break
                  }
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id)
                    }
                    break
                  case 'reversePolarity':
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    this.deviceConf[id][k] = v === 'false' ? false : !!v
                    break
                }
              }
            })
          } else {
            logIgnore(key)
          }
          break
        case 'name':
        case 'platform':
        case 'plugin_map':
          break
        case 'password':
        case 'userkey':
        case 'username':
          if (typeof val !== 'string') {
            logIgnore(key)
          } else {
            this.config[key] = val
          }
          break
        default:
          logRemove(key)
          break
      }
    }
  }

  async pluginSetup () {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', this.lang.initialised)

      // If the user has disabled the plugin then remove all accessories
      if (this.config.disablePlugin) {
        devicesInHB.forEach(accessory => this.removeAccessory(accessory))
        throw new Error(this.lang.disabled)
      }

      // Require any libraries that the accessory instances use
      this.colourUtils = require('./utils/colour-utils')
      this.cusChar = new (require('./utils/custom-chars'))(this.api)
      this.eveChar = new (require('./utils/eve-chars'))(this.api)

      // If the user has configured cloud username and password then get a device list
      let cloudDevices = []
      try {
        if (!this.config.username || !this.config.password) {
          throw new Error(this.lang.missingCreds)
        }
        cloudClient = new (require('./connection/http'))(this)
        this.accountDetails = await cloudClient.login()
        cloudDevices = await cloudClient.getDevices()

        // Initialise the cloud configured devices into Homebridge
        cloudDevices.forEach(device => this.initialiseDevice(device))
      } catch (err) {
        const eText = this.funcs.parseError(err, [this.lang.missingCreds])
        this.log.warn('%s %s.', this.lang.disablingCloud, eText)
        cloudClient = false
        this.accountDetails = {
          key: this.config.userkey
        }
      }

      // Check if a user key has been configured if the credentials aren't present
      if (cloudClient || this.config.userkey) {
        // Initialise the local configured devices into Homebridge
        Object.values(this.deviceConf)
          .filter(el => el.deviceUrl)
          .forEach(device => this.initialiseDevice(device))
      } else {
        // Cloud client disabled and no user key - plugin will be useless
        throw new Error(this.lang.noCredentials)
      }

      // Check for redundant accessories or those that have been ignored but exist
      devicesInHB.forEach(accessory => {
        switch (accessory.context.connection) {
          case 'cloud':
            if (!cloudDevices.some(el => el.uuid === accessory.context.serialNumber)) {
              this.removeAccessory(accessory)
            }
            break
          case 'local':
            if (!this.localUUIDs.includes(accessory.context.serialNumber)) {
              this.removeAccessory(accessory)
            }
            break
          default:
            // Should be a never case
            this.removeAccessory(accessory)
            break
        }
      })

      // Log that plugin setup is complete
      this.log('%s.', this.lang.complete)
    } catch (err) {
      // Catch any errors during setup
      const eText = this.funcs.parseError(err, [this.lang.disabled, this.lang.noCredentials])
      this.log.warn('***** %s. *****', this.lang.disabling)
      this.log.warn('***** %s. *****', eText)
      this.pluginShutdown()
    }
  }

  pluginShutdown () {
    // A function that is called when the plugin fails to load or Homebridge restarts
    try {
      // Close the mqtt connection for the accessories with an open connection
      if (cloudClient) {
        devicesInHB.forEach(accessory => {
          if (accessory.mqtt) {
            accessory.mqtt.disconnect()
          }
        })
        cloudClient.logout()
      }
    } catch (err) {
      // No need to show errors at this point
    }
  }

  async initialiseDevice (device) {
    try {
      // Local devices don't have the uuid already set
      if (device.deviceUrl) {
        // Rename some properties to fit the format of a cloud device
        device.uuid = device.serialNumber
        device.deviceType = device.model.toUpperCase().replace(/[-]+/g, '')
        device.devName = device.name
        device.channels = []

        // Retrieve how many channels this device has
        const channelCount = this.funcs.hasProperty(
          this.consts.models.switchMulti,
          device.deviceType
        )
          ? this.consts.models.switchMulti[device.deviceType]
          : 1

        // Create a list of channels to fit the format of a cloud device
        if (channelCount > 1) {
          for (let index = 0; index <= channelCount; index++) {
            device.channels.push({})
          }
        }
      }

      // Get any user configured entry for this device
      const deviceConf = this.deviceConf[device.uuid] || {}

      // Generate a unique id for the accessory
      const hbUUID = this.api.hap.uuid.generate(device.uuid)
      device.firmware = deviceConf.firmwareRevision || device.fmwareVersion
      device.hbDeviceId = device.uuid
      device.model = device.deviceType.toUpperCase().replace(/[-]+/g, '')
      let accessory

      // Add context information for the plugin-ui and instance to use
      const context = {
        channel: 0,
        channelCount: device.channels.length,
        connection: device.deviceUrl ? 'local' : 'cloud',
        deviceUrl: deviceConf.deviceUrl,
        domain: device.domain,
        firmware: device.firmware,
        hidden: false,
        isOnline: false,
        model: device.model,
        options: {
          adaptiveLightingShift: deviceConf.adaptiveLightingShift,
          brightnessStep: deviceConf.brightnessStep,
          hideChannels: deviceConf.hideChannels,
          inUsePowerThreshold: deviceConf.inUsePowerThreshold,
          operationTime: deviceConf.garageDoorOpeningTime,
          reversePolarity: deviceConf.reversePolarity
        },
        serialNumber: device.uuid
      }

      // Set the logging level for this device
      context.enableLogging = !this.config.disableDeviceLogging
      context.enableDebugLogging = this.config.debug
      switch (deviceConf.overrideLogging) {
        case 'standard':
          context.enableLogging = true
          context.enableDebugLogging = false
          break
        case 'debug':
          context.enableLogging = true
          context.enableDebugLogging = true
          break
        case 'disable':
          context.enableLogging = false
          context.enableDebugLogging = false
          break
      }

      // Find the correct instance determined by the device model
      if (this.consts.models.switchSingle.includes(device.model)) {
        /****************
        SWITCHES (SINGLE)
        ****************/
        let instance = deviceConf.showAs || 'switch'
        if (instance === 'default') {
          instance = 'switch'
        }

        // Set up the accessory and instance
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/' + instance + '-single'))(this, accessory)
        /***************/
      } else if (this.funcs.hasProperty(this.consts.models.switchMulti, device.model)) {
        /***************
        SWITCHES (MULTI)
        ***************/
        let instance = deviceConf.showAs || 'switch'
        if (instance === 'default') {
          instance = 'switch'
        }

        // Loop through the channels
        const devName = device.devName
        for (const index in device.channels) {
          // Check the entry exists
          if (!this.funcs.hasProperty(device.channels, index)) {
            return
          }
          const extraContext = {}

          // Generate the Homebridge UUID from the device uuid and channel index
          const uuidSub = device.uuid + index
          const hbUUIDSub = this.api.hap.uuid.generate(uuidSub)
          device.hbDeviceId = uuidSub

          // Supply a device name for the channel accessories
          if (index > 0) {
            device.devName = devName + ' SW' + index
          }

          // Check if the user has chosen to hide any channels for this device
          let subAcc
          if (this.hideChannels.includes(device.uuid + index)) {
            // The user has hidden this channel so if it exists then remove it
            if (devicesInHB.has(hbUUIDSub)) {
              this.removeAccessory(devicesInHB.get(hbUUIDSub))
            }

            // If this is the main channel then add it to the array of hidden masters
            if (index === 0) {
              this.hideMasters.push(device.uuid)
            }

            // Add the sub accessory, but hidden, to Homebridge
            extraContext.hidden = true
            extraContext.enableLogging = false
            extraContext.enableDebugLogging = false
            subAcc = this.addAccessory(device, true)
          } else {
            // The user has not hidden this channel
            subAcc = devicesInHB.get(hbUUIDSub) || this.addAccessory(device)
          }

          // Add the context information to the accessory
          extraContext.channel = parseInt(index)
          subAcc.context = { ...subAcc.context, ...context, ...extraContext }

          // Create the device type instance for this accessory
          subAcc.control = new (require('./device/' + instance + '-multi'))(
            this,
            subAcc,
            devicesInHB
          )

          // This is used for later in this function for logging
          if (index === '0') {
            accessory = subAcc
          } else {
            // Update any changes to the accessory to the platform
            this.api.updatePlatformAccessories(plugin.name, plugin.alias, [subAcc])
            devicesInHB.set(subAcc.UUID, subAcc)
          }
        }
        /**************/
      } else if (this.consts.models.lightDimmer.includes(device.model)) {
        /**************
        LIGHTS (DIMMER)
        **************/
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/light-dimmer'))(this, accessory)
        /*************/
      } else if (this.consts.models.lightRGB.includes(device.model)) {
        /***********
        LIGHTS (RGB)
        ***********/
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/light-rgb'))(this, accessory)
        /**********/
      } else if (this.consts.models.garage.includes(device.model)) {
        /***********
        GARAGE DOORS
        ***********/
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/garage'))(this, accessory)
        /**********/
      } else if (this.consts.models.roller.includes(device.model)) {
        /*************
        ROLLING MOTORS
        *************/
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/roller'))(this, accessory)
        /***********/
      } else if (this.consts.models.diffuser.includes(device.model)) {
        /********
        DIFFUSERS
        ********/
        accessory = devicesInHB.get(hbUUID) || this.addAccessory(device)
        accessory.context = { ...accessory.context, ...context }
        accessory.control = new (require('./device/diffuser'))(this, accessory)
        /******/
      } else if (this.consts.models.hubMain.includes(device.model)) {
        /**********
        SENSOR HUBS
        **********/
        // First, setup the main, hidden, accessory that will process the incoming updates
        accessory = this.addAccessory(device, true)
        accessory.context = { ...accessory.context, ...context, ...{ hidden: true } }
        accessory.control = new (require('./device/hub-main'))(this, accessory, devicesInHB)

        // Then request and initialise a list of subdevices
        const subdevices = await cloudClient.getSubDevices(device)
        if (!Array.isArray(subdevices)) {
          throw new Error('subdevice list not in correct format')
        }
        subdevices.forEach(subdevice => {
          try {
            // Create an object to mimic the addAccessory data
            const subdeviceObj = device
            const uuidSub = device.uuid + subdevice.subDeviceId
            const hbUUIDSub = this.api.hap.uuid.generate(uuidSub)
            subdeviceObj.devName = subdevice.subDeviceName || subdevice.subDeviceId
            subdeviceObj.hbDeviceId = uuidSub
            subdeviceObj.model = subdevice.subDeviceType.toUpperCase().replace(/[-]+/g, '')

            if (!this.consts.models.hubSub.includes(subdeviceObj.model)) {
              throw new Error('subdevice type is not supported yet')
            }

            const subAcc = devicesInHB.get(hbUUIDSub) || this.addAccessory(subdeviceObj)

            subAcc.context = {
              ...subAcc.context,
              ...context,
              ...{ subSerialNumber: subdevice.subDeviceId }
            }

            // Create the device type instance for this accessory
            subAcc.control = new (require('./device/hub-sensor'))(this, subAcc)

            // Update any changes to the accessory to the platform
            this.api.updatePlatformAccessories(plugin.name, plugin.alias, [subAcc])
            devicesInHB.set(subAcc.UUID, subAcc)
          } catch (err) {
            const eText = this.funcs.parseError(err, ['subdevice type is not supported yet'])
            this.log.warn('[%s] could not be added as %s.', subdevice.subDeviceName, eText)
          }
        })
        /*********/
      } else {
        /********************
        UNSUPPORTED AS OF YET
        ********************/
        this.log.warn('[%s] %s:\n%s', device.devName, this.lang.notSupp, JSON.stringify(device))
        return
        /*******************/
      }

      // Log the device initialisation
      this.log('[%s] %s [%s].', accessory.displayName, this.lang.devInit, device.uuid)

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during device initialisation
      const eText = this.funcs.parseError(err, [this.lang.accNotFound])
      this.log.warn('[%s] %s %s.', device.devName, this.lang.devNotInit, eText)
    }
  }

  addAccessory (device, hidden = false) {
    // Add an accessory to Homebridge
    try {
      const accessory = new this.api.platformAccessory(
        device.devName,
        this.api.hap.uuid.generate(device.hbDeviceId)
      )

      // If it isn't a hidden device then set the accessory characteristics
      if (!hidden) {
        accessory
          .getService(this.api.hap.Service.AccessoryInformation)
          .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.uuid)
          .setCharacteristic(this.api.hap.Characteristic.Manufacturer, this.lang.brand)
          .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
          .setCharacteristic(
            this.api.hap.Characteristic.FirmwareRevision,
            device.firmware || plugin.version
          )
          .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      }

      // Register the accessory if it hasn't been hidden by the user
      if (!hidden) {
        this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
        this.log('[%s] %s.', device.devName, this.lang.devAdd)
      }

      // Configure for good practice
      this.configureAccessory(accessory)

      // Return the new accessory
      return accessory
    } catch (err) {
      // Catch any errors during add
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.devName, this.lang.devNotAdd, eText)
      return false
    }
  }

  configureAccessory (accessory) {
    // Function is called to retrieve each accessory from the cache on startup
    try {
      if (!this.log) {
        return
      }

      // A function for when the identify button is pressed in HomeKit apps
      accessory.on('identify', (paired, callback) => {
        callback()
        this.log('[%s] %s.', accessory.displayName, this.lang.identify)
      })

      // Set the correct firmware version if we can
      if (this.api && accessory.context.firmware) {
        accessory
          .getService(this.api.hap.Service.AccessoryInformation)
          .updateCharacteristic(
            this.api.hap.Characteristic.FirmwareRevision,
            accessory.context.firmware
          )
      }

      // Add the configured accessory to our global map
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during retrieve
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotConf, eText)
    }
  }

  updateAccessory (accessory) {
    this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
  }

  removeAccessory (accessory) {
    try {
      // Remove an accessory from Homebridge
      this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, this.lang.devRemove)
    } catch (err) {
      // Catch any errors during remove
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotRemove, eText)
    }
  }

  async sendUpdate (accessory, toSend) {
    // Variable res is the response from either the cloud mqtt update or local http request
    let res

    // Generate the method variable determined from an empty payload or not
    toSend.method = Object.keys(toSend.payload).length === 0 ? 'GET' : 'SET'

    // Switch between either if the device is cloud control or local control
    switch (accessory.context.connection) {
      case 'cloud': {
        res = await accessory.mqtt.sendUpdate(toSend)
        break
      }
      case 'local': {
        // Check we have the user key
        if (!this.accountDetails.key) {
          throw new Error(this.lang.noUserKey)
        }

        // Generate the timestamp, messageId and sign from the userkey
        const timestamp = Math.floor(Date.now() / 1000)
        const messageId = this.funcs.generateRandomString(16)
        const sign = crypto
          .createHash('md5')
          .update(messageId + this.accountDetails.key + timestamp)
          .digest('hex')

        // Generate the payload to send
        const data = {
          header: {
            from: 'http://' + accessory.context.deviceUrl + '/config',
            messageId,
            method: toSend.method,
            namespace: toSend.namespace,
            payloadVersion: 1,
            sign,
            timestamp,
            triggerSrc: 'iOSLocal',
            uuid: accessory.context.serialNumber
          },

          payload: toSend.payload || {}
        }

        // Log the update if user enabled
        if (accessory.context.enableDebugLogging) {
          this.log(
            '[%s] %s: %s.',
            accessory.displayName,
            this.lang.sendUpdate,
            JSON.stringify(data)
          )
        }

        // Send the request to the device
        res = await axios({
          url: 'http://' + accessory.context.deviceUrl + '/config',
          method: 'post',
          headers: { 'content-type': 'application/json' },
          data,
          responseType: 'json',
          timeout: toSend.method === 'GET' ? 4000 : 9000
        })

        // Check the response properties based on whether it is a control or request update
        switch (toSend.method) {
          case 'GET': {
            // Validate the response, checking for payload property
            if (!res.data || !res.data.payload) {
              throw new Error('invalid response received')
            }
            break
          }
          case 'SET': {
            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }
        break
      }
    }

    // Return the response
    return res
  }
}

// Export the plugin to Homebridge
module.exports = hb => hb.registerPlatform(plugin.alias, MerossPlatform)
