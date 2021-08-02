/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceHubSensor {
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
    // this.enableLogging = accessory.context.enableLogging
    // this.enableDebugLogging = accessory.context.enableDebugLogging

    // Whilst in dev, override the logging to true
    this.enableLogging = true
    this.enableDebugLogging = true
    this.name = accessory.displayName

    // Add the temperature service if it doesn't already exist
    this.tempService =
      this.accessory.getService(this.hapServ.TemperatureSensor) ||
      this.accessory.addService(this.hapServ.TemperatureSensor)

    // Add the humidity service if it doesn't already exist
    this.humiService =
      this.accessory.getService(this.hapServ.HumiditySensor) ||
      this.accessory.addService(this.hapServ.HumiditySensor)

    // Add the battery service if it doesn't already exist
    this.battService =
      this.accessory.getService(this.hapServ.Battery) ||
      this.accessory.addService(this.hapServ.Battery)

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  applyUpdate (data) {
    try {
      // Temperature
      if (this.funcs.hasProperty(data, 'temperature') && data.temperature !== this.cacheTemp) {
        this.cacheTemp = data.temperature

        // Divide by 10 as reading is given as whole number inc decimal
        const newTemp = this.cacheTemp / 10
        this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
        if (this.enableLogging) {
          this.log('[%s] current temperature [%s°C].', this.name, newTemp)
        }
      }

      // Humidity
      if (this.funcs.hasProperty(data, 'humidity')) {
        // Divide by 10 and round as reading is given as whole number inc decimal
        const newHumi = Math.round(data.humidity / 10)
        if (newHumi !== this.cacheHumi) {
          this.cacheHumi = newHumi
          this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, newHumi)
          if (this.enableLogging) {
            this.log('[%s] current humidity [%s%].', this.name, newHumi)
          }
        }
      }

      // Voltage how to turn this reading into a %?
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}