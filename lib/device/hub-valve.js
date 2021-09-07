/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')
const { TimeoutError } = require('p-timeout')

module.exports = class deviceHubValve {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging
    this.lowBattThreshold = accessory.context.options.lowBattThreshold
      ? Math.min(accessory.context.options.lowBattThreshold, 100)
      : platform.consts.defaultValues.lowBattThreshold
    this.name = accessory.displayName

    // Add the thermostat service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Thermostat) ||
      this.accessory.addService(this.hapServ.Thermostat)

    /*
    // Add the battery service if it doesn't already exist
    this.battService =
      this.accessory.getService(this.hapServ.Battery) ||
      this.accessory.addService(this.hapServ.Battery)
    */

    this.service
      .getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1]
      })
      .onSet(async value => await this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState).value

    this.service
      .getCharacteristic(this.hapChar.TargetTemperature)
      .setProps({
        minValue: 5,
        maxValue: 35,
        minStep: 0.5
      })
      .onSet(async value => await this.internalTargetUpdate(value))
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.TargetTemperature).value

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Create the queue used for sending device requests
    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true
    })
    this.queue.on('idle', () => {
      this.updateInProgress = false
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      lowBattThreshold: this.lowBattThreshold
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true
        
        // Generate the payload and namespace
        const namespace = 'Appliance.Hub.ToggleX'
        const payload = {
          togglex: [{
            id: this.accessory.context.subSerialNumber,
            onoff: value
          }]
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTargetUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheTarg) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true
        
        // Generate the payload and namespace
        const namespace = 'Appliance.Hub.Mts100.Temperature'
        const payload = {
          temperature: [{
            custom: value * 10, 
            id: this.accessory.context.subSerialNumber
          }]
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheTarg = value
        if (this.enableLogging) {
          this.log('[%s] current target [%s°C].', this.name, value)
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  applyUpdate (data) {
    try {
      if (this.funcs.hasProperty(data, 'state')) {
        const newState = data.state

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheState !== newState) {
          this.service.updateCharacteristic(this.hapChar.TargetHeatingCoolingState, newState)
          this.cacheState = newState
          if (this.enableLogging) {
            this.log('[%s] current state [%s].', this.name, newState === 1 ? 'on' : 'off')
          }
        }
      }
      if (this.funcs.hasProperty(data, 'targTemperature')) {
        const newTarg = data.targTemperature

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTarg !== newTarg) {
          this.service.updateCharacteristic(this.hapChar.TargetTemperature, newTarg)
          this.cacheTarg = newTarg
          if (this.enableLogging) {
            this.log('[%s] current target [%s°C].', this.name, newTarg)
          }
        }
      }
      if (this.funcs.hasProperty(data, 'currTemperature')) {
        const newCurr = data.currTemperature

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheCurr !== newCurr) {
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, newCurr)
          this.cacheCurr = newCurr
          if (this.enableLogging) {
            this.log('[%s] current temperature [%s°C].', this.name, newCurr)
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.refFailed, eText)
    }
  }
}
