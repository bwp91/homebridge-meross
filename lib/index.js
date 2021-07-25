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
      this.ignoredDevices = []

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
        case 'cloudDevices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnoreItem(key)
                return
              }
              const id = x.serialNumber
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(key + '.' + id)
                return
              }
              this.config.cloudDevices[id] = {}
              for (const [k, v] of entries) {
                if (!this.consts.allowed[key].includes(k)) {
                  logRemove(key + '.' + id + '.' + k)
                  continue
                }
                switch (k) {
                  case 'firmwareRevision':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      this.config.cloudDevices[id][k] = v
                    }
                    break
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id)
                    }
                    break
                  case 'overrideLogging':
                  case 'showAs': {
                    const inSet = this.consts.allowed[k].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      this.config.cloudDevices[id][k] = inSet ? v : this.consts.defaultValues[k]
                    }
                    break
                  }
                }
              }
            })
          } else {
            logIgnore(key)
          }
          break
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
        case 'debugMerossCloud':
        case 'disableDeviceLogging':
        case 'disablePlugin':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'devices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.name || !x.model || !x.deviceUrl) {
                logIgnoreItem(key)
                return
              }
              const id = x.name
              const entries = Object.entries(x)
              const entry = {}
              for (const [k, v] of entries) {
                if (!this.consts.allowed[key].includes(k)) {
                  logRemove(key + '.' + id + '.' + k)
                  continue
                }
                switch (k) {
                  case 'channel':
                  case 'garageDoorOpeningTime':
                  case 'timestamp': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + id + '.' + k, this.consts.defaultValues[k])
                      entry[k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + id + '.' + k, this.consts.minValues[k])
                      entry[k] = this.consts.minValues[k]
                    } else {
                      entry[k] = intVal
                    }
                    break
                  }
                  case 'deviceUrl':
                  case 'firmwareRevision':
                  case 'messageId':
                  case 'model':
                  case 'name':
                  case 'serialNumber':
                  case 'sign':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      entry[k] = v
                    }
                    break
                  case 'overrideLogging':
                  case 'showAs': {
                    const inSet = this.consts.allowed[k].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(key + '.' + id + '.' + k)
                    } else {
                      entry[k] = inSet ? v : this.consts.defaultValues[k]
                    }
                    break
                  }
                }
              }
              this.config.devices.push(entry)
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
        case 'pushRate': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const numVal = Number(val)
          if (isNaN(numVal)) {
            logIgnore(key)
          } else if (numVal < this.consts.minValues[key]) {
            logIncrease(key, this.consts.minValues[key])
          } else {
            this.config[key] = numVal
          }
          break
        }
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

      // If the user has configured cloud username and password then get a device list
      let cloudDevices = []
      try {
        if (!this.config.username || !this.config.password) {
          throw new Error('credentials not supplied in config')
        }
        cloudClient = new (require('./connection/cloud/http'))(this)
        this.accountDetails = await cloudClient.login()
        cloudDevices = await cloudClient.getDevices()
        cloudDevices.forEach(device => {
          if (!this.ignoredDevices.includes(device.uuid)) {
            this.initialiseCloudDevice(device)
          }
        })
      } catch (err) {
        const eText = this.funcs.parseError(err)
        this.log.warn('Disabling cloud client as %s.', eText)
        cloudClient = false
        this.accountDetails = {
          key: this.config.userkey
        }
      }

      // Initialise the local configured devices into Homebridge
      this.config.devices.forEach(device => this.initialiseLocalDevice(device))

      // Check for redundant accessories or those that have been ignored but exist
      devicesInHB.forEach(accessory => {
        switch (accessory.context.connection) {
          case 'Cloud':
            if (!cloudDevices.some(el => el.uuid === accessory.context.serialNumber)) {
              this.removeAccessory(accessory)
            }
            break
          case 'Local':
            if (!this.config.devices.some(el => el.name === accessory.displayName)) {
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
      const eText = this.funcs.parseError(err)
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
      }
    } catch (err) {
      // No need to show errors at this point
    }
  }

  async initialiseCloudDevice (device) {
    try {
      // Generate a unique id for the accessory
      const uuid = this.api.hap.uuid.generate(device.uuid)
      device.deviceType = device.deviceType.toUpperCase().replace(/[-]+/g, '')

      // Get any user configured entry for this device
      const deviceConf = this.config.cloudDevices[device.uuid]

      // Find the correct instance determined by the device model
      let instance
      if (this.consts.models.cloud.switchSingle.includes(device.deviceType)) {
        instance = deviceConf && deviceConf.showAs ? deviceConf.showAs : 'switch'
        if (instance === 'default') {
          instance = 'switch'
        }
        instance += '-single'
      } else if (this.consts.models.cloud.switchMulti.includes(device.deviceType)) {
        instance = deviceConf && deviceConf.showAs ? deviceConf.showAs : 'switch'
        if (instance === 'default') {
          instance = 'switch'
        }
        instance += '-multi'
      } else if (this.consts.models.cloud.lightbulb.includes(device.deviceType)) {
        instance = 'lightbulb'
      } else if (this.consts.models.cloud.sensorHub.includes(device.deviceType)) {
        const subdevices = await cloudClient.getSubDevices(device)
        this.log.warn('[%s] %s:\n%s', device.devName, this.lang.notSupp, device)
        this.log(subdevices)
        if (devicesInHB.has(uuid)) {
          this.removeAccessory(devicesInHB.get(uuid))
        }
        return
      } else {
        this.log.warn('[%s] %s:\n%s', device.devName, this.lang.notSupp, device)
        return
      }

      if (deviceConf && deviceConf.firmwareRevision) {
        device.fmwareVersion = deviceConf.firmwareRevision
      }

      // Find the accessory if it already exists or create a new accessory
      const accessory = devicesInHB.get(uuid) || this.addCloudAccessory(device)

      // Final check the accessory exists
      if (!accessory) {
        throw new Error(this.lang.accNotFound)
      }

      // Add context information for the plugin-ui and instance to use
      accessory.context.connection = 'Cloud'
      accessory.context.serialNumber = device.uuid
      accessory.context.firmware = device.fmwareVersion
      accessory.context.channels = device.channels
      accessory.context.model = device.deviceType

      // Set the logging level for this device
      accessory.context.enableLogging = !this.config.disableDeviceLogging
      accessory.context.enableDebugLogging = this.config.debug
      if (deviceConf && deviceConf.overrideLogging) {
        switch (deviceConf.overrideLogging) {
          case 'standard':
            accessory.context.enableLogging = true
            accessory.context.enableDebugLogging = false
            break
          case 'debug':
            accessory.context.enableLogging = true
            accessory.context.enableDebugLogging = true
            break
          case 'disable':
            accessory.context.enableLogging = false
            accessory.context.enableDebugLogging = false
            break
        }
      }

      // Set up the mqtt client for the device to send and receive device updates
      accessory.mqtt = new (require('./connection/cloud/mqtt'))(this, accessory, device)
      accessory.mqtt.connect()

      // Set up the accessory instance
      accessory.control = new (require('./device/cloud/' + instance))(this, accessory)

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

  initialiseLocalDevice (device) {
    try {
      // Generate a unique id for the accessory
      const uuid = this.api.hap.uuid.generate(device.name + '-' + device.deviceUrl)
      device.model = device.model.toUpperCase().replace(/[-]+/g, '')

      // Find the correct instance determined by the device model
      let instance
      if (this.consts.models.local.switchSingle.includes(device.model)) {
        instance = device.showAs ? device.showAs : 'switch'
        if (instance === 'default') {
          instance = 'switch'
        }
        instance += '-single'
      } else if (this.consts.models.local.garage.includes(device.model)) {
        instance = 'garage'
      } else if (this.consts.models.local.lightbulb.includes(device.model)) {
        instance = 'lightbulb'
      } else {
        this.log.warn('[%s] %s %s.', device.name, device.model, this.lang.notSupp)
        return
      }

      // Find the accessory if it already exists or create a new accessory
      const accessory = devicesInHB.get(uuid) || this.addLocalAccessory(device)

      // Final check the accessory exists
      if (!accessory) {
        throw new Error(this.lang.accNotFound)
      }

      // Add context information for the plugin-ui and instance to use
      accessory.context.connection = 'Local'
      accessory.context.serialNumber = device.serialNumber
      accessory.context.messageId = device.messageId
      accessory.context.deviceUrl = device.deviceUrl
      accessory.context.sign = device.sign
      accessory.context.timestamp = device.timestamp
      accessory.context.model = device.model
      accessory.context.channel = device.channel || 0
      accessory.context.operationTime = device.garageDoorOpeningTime
      accessory.context.firmware = device.firmwareRevision

      // Set the logging level for this device
      accessory.context.enableLogging = !this.config.disableDeviceLogging
      accessory.context.enableDebugLogging = this.config.debug
      if (device.overrideLogging) {
        switch (device.overrideLogging) {
          case 'standard':
            accessory.context.enableLogging = true
            accessory.context.enableDebugLogging = false
            break
          case 'debug':
            accessory.context.enableLogging = true
            accessory.context.enableDebugLogging = true
            break
          case 'disable':
            accessory.context.enableLogging = false
            accessory.context.enableDebugLogging = false
            break
        }
      }

      // Create the instance for this device type
      accessory.control = new (require('./device/local/' + instance))(this, accessory)

      // Log the device initialisation
      this.log('[%s] %s [%s].', accessory.displayName, this.lang.devInit, device.serialNumber)

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during device initialisation
      const eText = this.funcs.parseError(err, [this.lang.accNotFound])
      this.log.warn('[%s] %s %s.', device.name, this.lang.devNotInit, eText)
    }
  }

  addCloudAccessory (device) {
    // Add an accessory to Homebridge
    try {
      const accessory = new this.api.platformAccessory(
        device.devName,
        this.api.hap.uuid.generate(device.uuid)
      )

      // Set the initial accessory information characteristics
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.uuid)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Meross')
        .setCharacteristic(this.api.hap.Characteristic.Model, device.deviceType)
        .setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          device.fmwareVersion || plugin.version
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)

      // Register the accessory into Homebridge and configure immediately
      this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
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

  addLocalAccessory (device) {
    // Add an accessory to Homebridge
    try {
      const accessory = new this.api.platformAccessory(
        device.name,
        this.api.hap.uuid.generate(device.name + '-' + device.deviceUrl)
      )

      // Set the initial accessory information characteristics
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(
          this.api.hap.Characteristic.SerialNumber,
          device.serialNumber || 'NOT SET'
        )
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Meross')
        .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
        .setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          device.firmwareRevision || plugin.version
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)

      // Register the accessory into Homebridge and configure immediately
      this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
      this.configureAccessory(accessory)

      // Return the new accessory
      return accessory
    } catch (err) {
      // Catch any errors during add
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.name, this.lang.devNotAdd, eText)
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

  async sendLocalDeviceUpdate (accessory, namespace, payload) {
    // Generate values depending on whether the user key is available/set
    const timestamp = this.accountDetails.key
      ? Math.floor(Date.now() / 1000)
      : accessory.context.timestamp
    const messageId = this.accountDetails.key
      ? this.funcs.generateRandomString(16)
      : accessory.context.messageId
    const sign = this.accountDetails.key
      ? crypto
          .createHash('md5')
          .update(messageId + this.accountDetails.key + timestamp)
          .digest('hex')
      : accessory.context.sign

    // Check we have a value for the messageId otherwise the command won't work
    if (!timestamp || !messageId || !sign) {
      throw new Error('user key, messageId, timestamp or sign has not been set')
    }

    // Generate the payload to send
    const data = {
      payload,
      header: {
        from: 'http://' + accessory.context.deviceUrl + '/config',
        messageId,
        method: 'SET',
        namespace,
        payloadVersion: 1,
        sign,
        timestamp,
        triggerSrc: 'iOSLocal',
        uuid:
          accessory.context.serialNumber && accessory.context.serialNumber.length > 30
            ? accessory.context.serialNumber
            : undefined
      }
    }

    // Log the update if user enabled
    if (accessory.context.enableDebugLogging) {
      this.log('[%s] sending update %s.', accessory.displayName, JSON.stringify(data))
    }

    // Send the request to the device
    const res = await axios({
      url: 'http://' + accessory.context.deviceUrl + '/config',
      method: 'post',
      headers: { 'content-type': 'application/json' },
      data,
      responseType: 'json'
    })

    // Return the response
    return res
  }

  async requestLocalDeviceUpdate (accessory, namespace) {
    // Generate values depending on whether the user key is available/set
    const timestamp = this.accountDetails.key
      ? Math.floor(Date.now() / 1000)
      : accessory.context.timestamp
    const messageId = this.accountDetails.key
      ? this.funcs.generateRandomString(16)
      : accessory.context.messageId
    const sign = this.accountDetails.key
      ? crypto
          .createHash('md5')
          .update(messageId + this.accountDetails.key + timestamp)
          .digest('hex')
      : accessory.context.sign

    // Check we have a value for the messageId otherwise the command won't work
    if (!timestamp || !messageId || !sign) {
      throw new Error('user key, messageId, timestamp or sign has not been set')
    }

    // Generate the payload to send
    const data = {
      payload: {},
      header: {
        from: 'http://' + accessory.context.deviceUrl + '/config',
        messageId,
        method: 'GET',
        namespace,
        payloadVersion: 1,
        sign,
        timestamp,
        triggerSrc: 'iOSLocal',
        uuid:
          accessory.context.serialNumber && accessory.context.serialNumber.length > 30
            ? accessory.context.serialNumber
            : undefined
      }
    }

    // Log the update if user enabled
    this.log('[%s] sending status request %s.', accessory.displayName, JSON.stringify(data))

    // Send the request to the device
    const res = await axios({
      url: 'http://' + accessory.context.deviceUrl + '/config',
      method: 'post',
      headers: { 'content-type': 'application/json' },
      data,
      responseType: 'json'
    })

    // Return the response
    return res
  }
}

// Export the plugin to Homebridge
module.exports = hb => hb.registerPlatform(plugin.alias, MerossPlatform)
