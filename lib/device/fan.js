import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'

import mqttClient from '../connection/mqtt.js'
import platformConsts from '../utils/constants.js'
import {
  generateRandomString,
  hasProperty,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

// NOTE this fan supports fan speeds of [1, 2, 3] OR [1, 2, 3, 4]
// Detectable by the fan array [{"speed":2,"maxSpeed":4,"channel":2}]

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.name = accessory.displayName
    const cloudRefreshRate = hasProperty(platform.config, 'cloudRefreshRate')
      ? platform.config.cloudRefreshRate
      : platformConsts.defaultValues.cloudRefreshRate
    const localRefreshRate = hasProperty(platform.config, 'refreshRate')
      ? platform.config.refreshRate
      : platformConsts.defaultValues.refreshRate
    this.pollInterval = accessory.context.connection === 'local'
      ? localRefreshRate
      : cloudRefreshRate

    this.hk2mr = (speed) => {
      if (speed <= 13) {
        return 0
      }
      if (speed <= 38) {
        return 1
      }
      if (speed <= 63) {
        return 2
      }
      if (speed <= 88) {
        return 3
      }
      return 4
    }

    this.mr2hk = (speed) => {
      if (speed === 0) {
        return 0
      }
      if (speed === 1) {
        return 25
      }
      if (speed === 2) {
        return 50
      }
      if (speed === 3) {
        return 75
      }
      return 100
    }

    // Add the fan service if it doesn't already exist
    this.fanService = this.accessory.getService('Fan')
    || this.accessory.addService(this.hapServ.Fan, 'Fan', 'fan')

    // Add the lightbulb service if it doesn't already exist
    this.lightService = this.accessory.getService('Light')
    || this.accessory.addService(this.hapServ.Lightbulb, 'Light', 'light')

    // Add the set handler to the fan on/off service
    this.fanService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalFanStateUpdate(value))
    this.cacheFanState = this.fanService.getCharacteristic(this.hapChar.On).value

    this.fanService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 25,
        validValues: [0, 25, 50, 75, 100],
      })
      .onSet(async value => this.internalFanSpeedUpdate(value))
    this.cacheFanSpeed = this.hk2mr(
      this.fanService.getCharacteristic(this.hapChar.RotationSpeed).value,
    )

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalLightStateUpdate(value))
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value

    // Add the set handler to the lightbulb brightness
    this.lightService
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightnessStep })
      .onSet(async value => this.internalLightBrightnessUpdate(value))
    this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

    // Create the queue used for sending device requests
    this.updateInProgress = false
    this.queue = new PQueue({
      concurrency: 1,
      interval: 250,
      intervalCap: 1,
      timeout: 10000,
      throwOnTimeout: true,
    })
    this.queue.on('idle', () => {
      this.updateInProgress = false
    })

    // Set up the mqtt client for cloud devices to send and receive device updates
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new mqttClient(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then start the interval for polling
    setTimeout(() => this.requestUpdate(true), 2000)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    )

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      showAs: 'switch',
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
  }

  async internalFanStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheFanState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: 2,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheFanState = value
        this.accessory.log(`[fan] ${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheFanState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalFanSpeedUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Some homekit apps might not support the valid values of 0, 33, 66, 99
        if (value < 13) {
          value = 0
        } else if (value <= 38) {
          value = 25
        } else if (value <= 63) {
          value = 50
        } else if (value <= 88) {
          value = 75
        } else {
          value = 100
        }

        // Don't continue if the state is the same as before
        const mrVal = this.hk2mr(value)
        if (mrVal === this.cacheFanSpeed) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.Fan'
        const payload = {
          fan: [
            {
              speed: mrVal,
              channel: 2,
            },
          ],
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // If using the slider to turn off then set the rotation speed back to original value
        // This stops homekit turning back to 100% if using the icon after turned off
        if (value === 0) {
          // Update the rotation speed back to the previous value (with the fan still off)
          setTimeout(() => {
            this.fanService.updateCharacteristic(
              this.hapChar.RotationSpeed,
              this.mr2hk(this.cacheFanSpeed),
            )
          }, 2000)
        } else {
          // Update the cache and log the update has been successful
          this.cacheFanSpeed = mrVal
          this.accessory.log(`${platformLang.curDiffSpray} [${this.hk2Label(value)}]`)
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.fanService.updateCharacteristic(
          this.hapChar.RotationSpeed,
          this.mr2hk(this.cacheFanSpeed),
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheLightState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: 1,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheLightState = value
        this.accessory.log(`[light] ${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightBrightnessUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheLightBright === value) {
          return
        }

        // Avoid multiple changes in short space of time
        const updateKey = generateRandomString(5)
        this.updateKeyBright = updateKey
        await sleep(300)
        if (updateKey !== this.updateKeyBright) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload to send for the correct device model
        const namespace = 'Appliance.Control.Light'
        const payload = {
          light: {
            luminance: value,
            channel: 1,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheLightBright = value
        this.accessory.log(`${platformLang.curLightBright} [${value}%]`)
      })
    } catch (err) {
      const eText = parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheLightBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async requestUpdate(firstRun = false) {
    try {
      // Don't continue if an update is currently being sent to the device
      if (this.updateInProgress) {
        return
      }

      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Send the request
        const res = await this.platform.sendUpdate(this.accessory, {
          namespace: 'Appliance.System.All',
          payload: {},
        })

        // Log the received data
        this.accessory.logDebug(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`)

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all) {
          if (data.all.digest) {
            this.applyUpdate(data.all.digest)
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (data.all.system) {
            // Mac address and hardware don't change regularly so only get on first poll
            if (firstRun && data.all.system.hardware) {
              this.accessory.context.macAddress = data.all.system.hardware.macAddress.toUpperCase()
              this.accessory.context.hardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              // Check for an IP change each and every time the device is polled
              if (this.accessory.context.ipAddress !== data.all.system.firmware.innerIp) {
                this.accessory.context.ipAddress = data.all.system.firmware.innerIp
                needsUpdate = true
              }

              // Firmware doesn't change regularly so only get on first poll
              if (firstRun) {
                this.accessory.context.firmware = data.all.system.firmware.version
              }
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.accessory.context.isOnline !== isOnline) {
              this.accessory.context.isOnline = isOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate || firstRun) {
            this.platform.updateAccessory(this.accessory)
          }
        }
      })
    } catch (err) {
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logDebugWarn(`${platformLang.reqFailed}: ${eText}`)

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (
        (this.accessory.context.isOnline || firstRun)
        && ['EHOSTUNREACH', 'timed out'].some(el => eText.includes(el))
      ) {
        this.accessory.context.isOnline = false
        this.platform.updateAccessory(this.accessory)
      }
    }
  }

  receiveUpdate(params) {
    try {
      if (params.payload) {
        this.applyUpdate(params.payload)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    this.accessory.logDebug('RECEIVING')
    this.accessory.logDebug(JSON.stringify(data))
    this.accessory.logDebug('END RECEIVING')

    if (data.togglex) {
      // Update the fan state if present
      const lightState = data.togglex.find(el => el.channel === 1)
      if (lightState) {
        const newOn = lightState.onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightState !== newOn) {
          this.lightService.updateCharacteristic(this.hapChar.On, newOn)
          this.cacheLightState = newOn
          this.accessory.log(`${platformLang.curState} [${this.cacheLightState}]`)
        }
      }

      // Update the fan state if present
      const fanState = data.togglex.find(el => el.channel === 2)
      if (fanState) {
        const newOn = fanState.onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanState !== newOn) {
          this.fanService.updateCharacteristic(this.hapChar.On, newOn)
          this.cacheFanState = newOn
          this.accessory.log(`${platformLang.curState} [${this.cacheFanState}]`)
        }
      }
    }

    // data fan comes in as an array, the first item is the fan
    if (data.fan && Array.isArray(data.fan) && data.fan.length > 0) {
      // Update the fan state if present
      if (hasProperty(data.fan[0], 'onoff')) {
        const newOn = data.fan[0].onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanState !== newOn) {
          this.fanService.updateCharacteristic(this.hapChar.On, newOn)
          this.cacheFanState = newOn
          this.accessory.log(`[fan] ${platformLang.curState} [${this.cacheFanState}]`)
        }
      }

      // Update the fan speed if present
      if (hasProperty(data.fan[0], 'speed')) {
        const newSpeed = data.fan[0].speed

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheFanSpeed !== newSpeed) {
          this.cacheFanSpeed = newSpeed
          const hkValue = this.mr2hk(this.cacheFanSpeed)
          this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, hkValue)
          this.accessory.log(`[fan] ${platformLang.curSpeed} [${this.cacheFanSpeed}%]`)
        }
      }
    }

    // data light comes in as an object
    if (data.light) {
      // Update the lightbulb state if present
      if (hasProperty(data.light, 'onoff')) {
        const newOn = data.light.onoff === 1

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheLightState !== newOn) {
          this.lightService.updateCharacteristic(this.hapChar.On, newOn)
          this.cacheLightState = newOn
          this.accessory.log(`[light] ${platformLang.curState} [${this.cacheLightState}]`)
        }
      }

      // Update the lightbulb brightness if present
      if (hasProperty(data.light, 'luminance')) {
        const newBright = data.light.luminance

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheBright !== newBright) {
          this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright)
          this.cacheBright = newBright
          this.accessory.log(`[light] ${platformLang.curBright} [${this.cacheBright}%]`)
        }
      }
    }
  }
}
