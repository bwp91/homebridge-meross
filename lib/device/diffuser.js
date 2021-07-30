/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceDIffuser {
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
    // this.enableLogging = accessory.context.enableLogging
    // this.enableDebugLogging = accessory.context.enableDebugLogging
    this.enableLogging = true
    this.enableDebugLogging = true
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.platform.config.cloudRefreshRate * 1000
        : this.platform.config.refreshRate * 1000

    // Add the diffuser (fan) service if it doesn't already exist
    this.fanService =
      this.accessory.getService('Diffuser') ||
      this.accessory.addService(this.hapServ.Fan, 'Diffuser', 'diffuser')

    // Add the lightbulb service if it doesn't already exist
    this.lightService =
      this.accessory.getService('Light') ||
      this.accessory.addService(this.hapServ.Lightbulb, 'Light', 'light')

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => await this.internalLightStateUpdate(value))
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value

    // Add the set handler to the lightbulb brightness
    this.lightService
      .getCharacteristic(this.hapChar.Brightness)
      .onSet(async value => await this.internalLightBrightnessUpdate(value))
    this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

    // Add the set handler to the lightbulb hue characteristic
    this.lightService
      .getCharacteristic(this.hapChar.Hue)
      .onSet(async value => await this.internalLightColourUpdate(value))
    this.cacheLightHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
    this.cacheLightSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value

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

      // Override disabled cloud polling whilst real-time updates aren't available
      if (this.pollInterval === 0) {
        this.pollInterval = 30000
      }
    }

    // Always request a device update on startup, then enable polling if user enabled
    this.requestUpdate(true)
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

    /*
      NOTES
      - INTO RAINBOW MODE:
        "light" : [
          {
            "channel" : 0,
            "mode" : 0
          }
        ]

      - INTO TEMPERATURE MODE:
        "light" : [
          {
            "channel" : 0,
            "mode" : 2
          }
        ]

      - SPRAY: (0=OFF, 2=MILD, 1=FULL
        "spray" : [
          {
            "mode" : 1,
            "channel" : 0
          }
        ]
    */
  }

  async internalLightStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheLightState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Diffuser.Light'
        const payload = {
          type: 'mod100',
          light: [
            {
              onoff: value ? 1 : 0,
              channel: 0
            }
          ]
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheLightState = value
        if (this.enableLogging) {
          this.log('[%s] current light state [%s].', this.name, value ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightBrightnessUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheLightBright === value) {
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
        const namespace = 'Appliance.Control.Diffuser.Light'
        const payload = {
          type: 'mod100',
          light: [
            {
              luminance: value,
              channel: 0
            }
          ]
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheLightBright = value
        if (this.enableLogging) {
          this.log('[%s] current light brightness [%s%].', this.name, value)
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheLightBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightColourUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheLightHue === value) {
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
        const saturation = this.lightService.getCharacteristic(this.hapChar.Saturation).value
        const [r, g, b] = this.colourUtils.hs2rgb(value, saturation)
        const rgbD = (r << 16) + (g << 8) + b

        // Generate the payload to send
        const namespace = 'Appliance.Control.Diffuser.Light'
        const payload = {
          type: 'mod100',
          light: [{
            rgb: rgbD,
            mode: 1,
            channel: 0
          }]
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheLightHue = value
        this.cacheLightSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
        if (this.enableLogging) {
          this.log(
            '[%s] current light hue/sat [%s/%s] rgb [%s, %s, %s].',
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
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheLightHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate (firstRun = false) {
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
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {}
        })

        // Log the received data
        if (this.enableDebugLogging) {
          this.log('[%s] incoming poll: %s.', this.name, JSON.stringify(res.data))
        }

        // Check the response is in a useful format
        const data = res.data.payload

        if (data.all) {
          if (data.all.digest && data.all.digest.diffuser) {
            this.applyUpdate(data.all.digest.diffuser)
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Mac address, IP and firmware don't change regularly so only get on first poll
          if (firstRun) {
            // Get the mac address and hardware version of the device
            if (data.all.system) {
              if (data.all.system.hardware) {
                this.cacheMac = (data.all.system.hardware.macAddress || '').toUpperCase()
                if (this.cacheMac !== this.accessory.context.macAddress) {
                  this.accessory.context.macAddress = this.cacheMac
                  needsUpdate = true
                }
                this.cacheHardware = data.all.system.hardware.version
                if (this.cacheHardware !== this.accessory.context.hardware) {
                  this.accessory.context.hardware = this.cacheHardware
                  needsUpdate = true
                }
              }

              // Get the ip address and firmware of the device
              if (data.all.system.firmware) {
                this.cacheIp = data.all.system.firmware.innerIp
                if (this.cacheIp !== this.accessory.context.ipAddress) {
                  this.accessory.context.ipAddress = this.cacheIp
                  needsUpdate = true
                }

                if (!this.accessory.context.firmware) {
                  this.cacheFirmware = data.all.system.firmware.version
                  if (this.cacheFirmware !== this.accessory.context.firmware) {
                    this.accessory.context.firmware = this.cacheFirmware
                    needsUpdate = true
                  }
                }
              }
            }

            // Get the cloud online status of the device
            if (data.all.system.online) {
              this.cacheOnline = data.all.system.online.status === 1
              if (this.cacheOnline !== this.accessory.context.isOnline) {
                this.accessory.context.isOnline = this.cacheOnline
                needsUpdate = true
              }
            }

            // Update the accessory cache if anything has changed
            if (needsUpdate) {
              this.platform.updateAccessory(this.accessory)
            }
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt: %s.', this.name, JSON.stringify(params))
      }

      // Check the response is in a useful format
      const data = params.payload

      // Not supported as of yet, so log for a user to bring to my attention
      this.log.warn('[%s] real-time diffuser cloud updates not supported.', this.name)
      this.log.warn('[%s] please post the below message in a github issue.', this.name)
      this.log.warn('[%s] %s.', this.name, JSON.stringify(data))
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
    if (data.light && data.light[0]) {
      if (this.funcs.hasProperty(data.light[0], 'onoff')) {
        const newState = data.light[0].onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightState !== newState) {
          this.lightService.updateCharacteristic(this.hapChar.On, newState)
          this.cacheLightState = newState
          if (this.enableLogging) {
            this.log(
              '[%s] current light state [%s].',
              this.name,
              this.cacheLightState ? 'on' : 'off'
            )
          }
        }
      }
      if (this.funcs.hasProperty(data.light[0], 'luminance')) {
        const newBright = data.light[0].luminance

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheBright !== newBright) {
          this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright)
          this.cacheLightBright = newBright
          if (this.enableLogging) {
            this.log('[%s] current light brightness [%s%].', this.name, this.cacheLightBright)
          }
        }
      }
      if (data.light[0].mode === 1 && this.funcs.hasProperty(data.light[0], 'rgb')) {
        const newRGB = data.light[0].rgb
        const r = (newRGB & 0xff0000) >> 16
        const g = (newRGB & 0x00ff00) >> 8
        const b = newRGB & 0x0000ff
        const [newHue, newSat] = this.colourUtils.rgb2hs(r, g, b)

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightHue !== newHue || this.cacheLightSat !== newSat) {
          this.lightService.updateCharacteristic(this.hapChar.Hue, newHue)
          this.lightService.updateCharacteristic(this.hapChar.Saturation, newSat)
          this.cacheLightHue = newHue
          this.cacheLightSat = newSat
          if (this.enableLogging) {
            this.log(
              '[%s] current light hue/sat [%s/%s] rgb [%s, %s, %s].',
              this.name,
              this.cacheLightHue,
              this.cacheLightSat,
              r,
              g,
              b
            )
          }
        }
      }
    }
  }
}
