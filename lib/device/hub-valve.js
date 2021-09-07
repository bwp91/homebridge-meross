/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

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
    this.tempService =
      this.accessory.getService(this.hapServ.Thermostat) ||
      this.accessory.addService(this.hapServ.Thermostat)

    /*
    // Add the battery service if it doesn't already exist
    this.battService =
      this.accessory.getService(this.hapServ.Battery) ||
      this.accessory.addService(this.hapServ.Battery)
    */

    this.tempService.getCharacteristic(this.hapChar.HeatingThresholdTemperature).setProps({
      minValue: 5,
      maxValue: 35,
      minStep: 0.5
    })

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      lowBattThreshold: this.lowBattThreshold
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  applyUpdate (data) {
    try {
      if (this.funcs.hasProperty(data, 'targTemperature')) {
        const newTarg = data.targTemperature

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheTarg !== newTarg) {
          this.tempService.updateCharacteristic(this.hapChar.TargetTemperature, newTarg)
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
          this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, newCurr)
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
