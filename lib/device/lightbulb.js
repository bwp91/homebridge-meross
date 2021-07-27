/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceLightbulb {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.colourUtils = platform.colourUtils
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
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000

    // Add the switch service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Lightbulb) ||
      this.accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => await this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .onSet(async value => await this.internalBrightnessUpdate(value))
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value

    // Some models allow for colour and colour temperature
    if (
      ['MSL100', 'MSL420', 'MSL120', 'MSL320', 'MSL320M'].includes(this.accessory.context.model)
    ) {
      // Add the set handler to the lightbulb hue characteristic
      this.service
        .getCharacteristic(this.hapChar.Hue)
        .onSet(async value => await this.internalColourUpdate(value))
      this.cacheHue = this.service.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

      // Add the set handler to the lightbulb colour temperature characteristic
      this.service
        .getCharacteristic(this.hapChar.ColorTemperature)
        .onSet(async value => await this.internalCTUpdate(value))
      this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value

      // Set up adaptive lighting
      this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: 0
      })
      this.accessory.configureController(this.alController)
      this.accessory.context.adaptiveLighting = true
    }

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

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection === 'cloud') {
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then enable polling if user enabled
    this.requestUpdate()
    if (this.pollInterval > 0) {
      this.refreshinterval = setInterval(() => this.requestUpdate(), this.pollInterval)
    }

    // Stop the intervals and close mqtt connection on Homebridge shutdown
    platform.api.on('shutdown', () => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }
      if (this.accessory.mqtt) {
        this.accessory.mqtt.disconnect()
      }
    })
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

        switch (this.accessory.context.connection) {
          case 'cloud': {
            // Send the update
            await this.accessory.mqtt.controlToggleX(0, value)
            break
          }
          case 'local': {
            // Generate the payload and namespace
            const namespace = 'Appliance.Control.ToggleX'
            const payload = {
              togglex: {
                onoff: value ? 1 : 0,
                channel: 0
              }
            }

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheBright === value) {
          return
        }

        // Avoid multiple changes in short space of time
        const updateKey = Math.random()
          .toString(36)
          .substr(2, 8)
        this.updateKeyBright = updateKey
        await this.funcs.sleep(300)
        if (updateKey !== this.updateKeyBright) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload to send for the correct device model
        let payload
        if (['MSL100', 'MSL420', 'MSL120', 'MSL320'].includes(this.accessory.context.model)) {
          payload = {
            light: {
              luminance: value,
              capacity: 4,
              channel: 0
            }
          }
        } else {
          payload = {
            light: {
              luminance: value,
              channel: 0
            }
          }
        }

        switch (this.accessory.context.connection) {
          case 'cloud': {
            // Send the update
            await this.accessory.mqtt.controlLight(payload.light)
            break
          }
          case 'local': {
            // Generate the namespace
            const namespace = 'Appliance.Control.Light'

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
          }
        }

        // Update the cache and log the update has been successful
        this.cacheBright = value
        if (this.enableLogging) {
          this.log('[%s] current brightness [%s%].', this.name, value)
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheHue === value) {
          return
        }

        // Avoid multiple changes in short space of time
        const updateKey = Math.random()
          .toString(36)
          .substr(2, 8)
        this.updateKeyColour = updateKey
        await this.funcs.sleep(300)
        if (updateKey !== this.updateKeyColour) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Convert to RGB
        const saturation = this.service.getCharacteristic(this.hapChar.Saturation).value
        const [r, g, b] = this.colourUtils.hs2rgb(value, saturation)
        const rgbD = (r << 16) + (g << 8) + b

        // Generate the payload to send
        const payload = {
          light: {
            rgb: rgbD,
            capacity: 1,
            luminance: this.cacheBright,
            temperature: -1,
            channel: 0
          }
        }

        switch (this.accessory.context.connection) {
          case 'cloud': {
            // Send the update
            await this.accessory.mqtt.controlLight(payload.light)
            break
          }
          case 'local': {
            // Generate the namespace
            const namespace = 'Appliance.Control.Light'

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }

        // Update the cache and log the update has been successful
        this.cacheHue = value
        this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value
        if (this.enableLogging) {
          this.log(
            '[%s] current hue/sat [%s/%s] rgb [%s, %s, %s].',
            this.name,
            this.cacheHue,
            this.cacheSat,
            r,
            g,
            b
          )
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheMired === value) {
          return
        }

        // Avoid multiple changes in short space of time
        const updateKey = Math.random()
          .toString(36)
          .substr(2, 8)
        this.updateKeyCT = updateKey
        await this.funcs.sleep(300)
        if (updateKey !== this.updateKeyCT) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Don't continue if the new value is the same as before
        if (!this.cacheState || this.cacheMired === value) {
          return
        }

        // Convert kelvin to Meross value
        let merossTemp = value - 140
        merossTemp = 360 - merossTemp
        merossTemp = merossTemp / 360
        merossTemp = Math.round(merossTemp * 100)
        merossTemp = merossTemp === 0 ? 1 : merossTemp

        // Generate the payload to send
        const payload = {
          light: {
            temperature: merossTemp,
            capacity: 2,
            channel: 0
          }
        }

        switch (this.accessory.context.connection) {
          case 'cloud': {
            // Send the update
            await this.accessory.mqtt.controlLight(payload.light)
            break
          }
          case 'local': {
            // Generate the namespace
            const namespace = 'Appliance.Control.Light'

            // Use the platform function to send the update to the device
            const res = await this.platform.sendLocalDeviceUpdate(
              this.accessory,
              namespace,
              payload
            )

            // Check the response
            if (!res.data || !res.data.header || res.data.header.method === 'ERROR') {
              throw new Error('request failed - ' + JSON.stringify(res.data.payload.error))
            }
            break
          }
        }

        // Update the cache and log the update has been successful
        this.cacheMired = value
        if (this.enableLogging) {
          const kelvin = Math.round(1000000 / this.cacheMired)
          const al =
            this.alController && this.alController.isAdaptiveLightingActive()
              ? ' via adaptive lighting'
              : ''
          this.log('[%s] current mired/kelvin [%s/%s]%s.', this.name, this.cacheMired, kelvin, al)
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate () {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the request
        const res =
          this.accessory.context.connection === 'cloud'
            ? await this.accessory.mqtt.getSystemAllData()
            : await this.platform.requestLocalUpdate(this.accessory, 'Appliance.System.All')

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
        }

        // Validate the response, checking for payload property
        if (!res.data || !res.data.payload) {
          throw new Error('invalid response received')
        }
        const data = res.data.payload

        if (data.all && data.all.digest) {
          if (this.accessory.context.model === 'MSS1101') {
            if (this.funcs.hasProperty(data.all.digest.toggle, 'onoff')) {
              // newState is given as 0 or 1 -> convert to bool for HomeKit
              const newState = data.all.digest.toggle.onoff === 1

              // Check against the cache and update HomeKit and the cache if needed
              if (this.cacheState !== newState) {
                this.service.updateCharacteristic(this.hapChar.On, newState)
                this.cacheState = newState
                if (this.enableLogging) {
                  this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off')
                }
              }
            }
          } else {
            if (
              data.all.digest.togglex &&
              data.all.digest.togglex[0] &&
              this.funcs.hasProperty(data.all.digest.togglex[0], 'onoff')
            ) {
              // newState is given as 0 or 1 -> convert to bool for HomeKit
              const newState = data.all.digest.togglex[0].onoff === 1

              // Check against the cache and update HomeKit and the cache if needed
              if (this.cacheState !== newState) {
                this.service.updateCharacteristic(this.hapChar.On, newState)
                this.cacheState = newState
                if (this.enableLogging) {
                  this.log('[%s] current state [%s].', this.name, this.cacheState ? 'on' : 'off')
                }
              }
            }
            if (data.all.digest.light) {
              if (
                data.all.digest.light.capacity === 4 &&
                this.funcs.hasProperty(data.all.digest.light, 'luminance')
              ) {
                const newBright = data.all.digest.light.luminance

                // Check against the cache and update HomeKit and the cache if needed
                if (this.cacheState !== newBright) {
                  this.service.updateCharacteristic(this.hapChar.Brightness, newBright)
                  this.cacheState = newBright
                  if (this.enableLogging) {
                    this.log('[%s] current brightness [%s%].', this.name, this.cacheBright)
                  }
                }
              }
              if (
                data.all.digest.light.capacity === 1 &&
                this.funcs.hasProperty(data.all.digest.light, 'rgb') &&
                data.all.digest.light.rgb !== -1
              ) {
                const newRGB = data.all.digest.light.rgb
                const r = (newRGB & 0xff0000) >> 16
                const g = (newRGB & 0x00ff00) >> 8
                const b = newRGB & 0x0000ff
                const [newHue, newSat] = this.colourUtils.rgb2hs(r, g, b)

                // Check against the cache and update HomeKit and the cache if needed
                if (this.cacheHue !== newHue || this.cacheSat !== newSat) {
                  this.service.updateCharacteristic(this.hapChar.Hue, newHue)
                  this.service.updateCharacteristic(this.hapChar.Saturation, newSat)
                  this.cacheHue = newHue
                  this.cacheSat = newSat
                  if (this.enableLogging) {
                    this.log(
                      '[%s] current hue/sat [%s/%s] rgb [%s, %s, %s].',
                      this.name,
                      this.cacheHue,
                      this.cacheSat,
                      r,
                      g,
                      b
                    )
                  }
                }
                //  Disable adaptive lighting
                if (this.alController && this.alController.isAdaptiveLightingActive()) {
                  this.alController.disableAdaptiveLighting()
                  if (this.enableLogging) {
                    this.log('[%s] adaptive lighting disabled as RGB colour chosen.', this.name)
                  }
                }
              }
              if (
                data.all.digest.light.capacity === 2 &&
                this.funcs.hasProperty(data.all.digest.light, 'temperature') &&
                data.all.digest.light.temperature !== -1
              ) {
                let merossTemp = (data.all.digest.light.temperature / 100) * 360
                merossTemp = 360 - merossTemp
                merossTemp = merossTemp + 140
                merossTemp = Math.round(merossTemp)

                // Check against the cache and update HomeKit and the cache if needed
                if (this.cacheMired !== merossTemp) {
                  const dif = Math.abs(this.cacheMired - merossTemp)
                  this.service.updateCharacteristic(this.hapChar.ColorTemperature, merossTemp)
                  this.cacheMired = merossTemp
                  if (this.enableLogging) {
                    const kelvin = Math.round(1000000 / this.cacheMired)
                    this.log(
                      '[%s] current mired/kelvin [%s/%s].',
                      this.name,
                      this.cacheMired,
                      kelvin
                    )
                  }
                  if (
                    dif > 10 &&
                    this.alController &&
                    this.alController.isAdaptiveLightingActive()
                  ) {
                    this.alController.disableAdaptiveLighting()
                    if (this.enableLogging) {
                      this.log('[%s] adaptive lighting disabled due to change of mired.', this.name)
                    }
                  }
                }
              }
            }
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  externalUpdate (namespace, params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt [%s]: %s.', this.name, namespace, JSON.stringify(params))
      }

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload

      // Not supported as of yet, so log for a user to bring to my attention
      this.log.warn('[%s] real-time light cloud updates not supported.', this.name)
      this.log.warn('[%s] please post the below message in a github issue.', this.name)
      this.log.warn('[%s] %s.', this.name, JSON.stringify(data))
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }
}
