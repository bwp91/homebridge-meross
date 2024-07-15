import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'
import mqttClient from '../connection/mqtt.js'
import { hk2mrCT, mr2hkCT } from '../utils/colour.js'
import platformConsts from '../utils/constants.js'
import {
  generateRandomString,
  hasProperty,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.alShift = this.accessory.context.options.adaptiveLightingShift
    || platformConsts.defaultValues.adaptiveLightingShift
    this.brightnessStep = this.accessory.context.options.brightnessStep || platformConsts.defaultValues.brightnessStep
    this.brightnessStep = Math.min(this.brightnessStep, 100)
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
    this.hasNightLight = accessory.context.model === 'MSL210'

    // Add the lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
    || this.accessory.addService(this.hapServ.Lightbulb)

    // If adaptive lighting has just been disabled then remove and re-add service to hide AL icon
    if (this.alShift === -1 && this.accessory.context.adaptiveLighting) {
      this.accessory.removeService(this.service)
      this.service = this.accessory.addService(this.hapServ.Lightbulb)
      this.accessory.context.adaptiveLighting = false
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightnessStep })
      .onSet(async value => this.internalBrightnessUpdate(value))
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value

    // Add the set handler to the lightbulb colour temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.ColorTemperature)
      .onSet(async value => this.internalCTUpdate(value))
    this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value

    // Add the night mode characteristics if supported model
    if (this.hasNightLight) {
      if (!this.service.testCharacteristic(this.cusChar.LightNightWarm)) {
        this.service.addCharacteristic(this.cusChar.LightNightWarm)
      }
      if (!this.service.testCharacteristic(this.cusChar.LightNightWhite)) {
        this.service.addCharacteristic(this.cusChar.LightNightWhite)
      }
      this.service
        .getCharacteristic(this.cusChar.LightNightWarm)
        .onSet(async value => this.internalNightUpdate(6, value))
      this.service
        .getCharacteristic(this.cusChar.LightNightWarm)
        .onSet(async value => this.internalNightUpdate(5, value))

      // Object of effect to description
      this.nightModes = {
        5: 'night warm',
        6: 'night white',
      }
    }

    // Set up the adaptive lighting controller if not disabled by user
    if (this.alShift !== -1) {
      this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
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
      adaptiveLightingShift: this.alShift,
      brightnessStep: this.brightnessStep,
      connection: this.accessory.context.connection,
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: 0,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        this.accessory.log(`${platformLang.curState} [${value ? 'on' : 'off'}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheBright === value) {
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
        const payload = {
          light: {
            luminance: value,
            capacity: 4,
            channel: 0,
          },
        }

        // Generate the namespace
        const namespace = 'Appliance.Control.Light'

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      })
    } catch (err) {
      const eText = parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (this.cacheMired === value) {
          return
        }

        // Avoid multiple changes in short space of time
        const updateKey = generateRandomString(5)
        this.updateKeyCT = updateKey
        await sleep(300)
        if (updateKey !== this.updateKeyCT) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Don't continue if the new value is the same as before
        if (!this.cacheState || this.cacheMired === value) {
          return
        }

        // Generate the payload to send
        const payload = {
          light: {
            temperature: hk2mrCT(value),
            capacity: 2,
            channel: 0,
          },
        }

        // Generate the namespace
        const namespace = 'Appliance.Control.Light'

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheMired = value
        const kelvin = Math.round(1000000 / this.cacheMired)
        const al = this.alController && this.alController.isAdaptiveLightingActive()
          ? ` ${platformLang.viaAL}`
          : ''
        this.accessory.log(`${platformLang.curLightTemp} [${this.cacheMired} / ${kelvin}]${al}`)
      })
    } catch (err) {
      const eText = parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalNightUpdate(effect, value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Temp return whilst payload is unknown
        this.accessory.log(`${effect} ${value}`)

        /*
          // Generate the payload and namespace
          const namespace = 'Appliance.Control.Light';
          const payload = {
            // Unknown
          };

          // Use the platform function to send the update to the device
          await this.platform.sendUpdate(this.accessory, {
            namespace,
            payload,
          });

          // Log the update has been successful
          this.accessory.log('[%s] current mode [%s].', this.name, this.nightModes[effect]);
        */
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.cusChar.On, this.cacheState)
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
      // Log the received data
      this.accessory.logDebug(`${platformLang.incMQTT}: ${JSON.stringify(params)}`)

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload
      if (data.togglex || data.light) {
        this.applyUpdate(data)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    if (data.togglex && data.togglex[0] && hasProperty(data.togglex[0], 'onoff')) {
      // newState is given as 0 or 1 -> convert to bool for HomeKit
      const newState = data.togglex[0].onoff === 1

      // Check against the cache and update HomeKit and the cache if needed
      if (this.cacheState !== newState) {
        this.service.updateCharacteristic(this.hapChar.On, newState)
        this.cacheState = newState
        this.accessory.log(`${platformLang.curState} [${this.cacheState ? 'on' : 'off'}]`)
      }
    }
    if (data.light) {
      if (hasProperty(data.light, 'luminance')) {
        const newBright = data.light.luminance

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheBright !== newBright) {
          this.service.updateCharacteristic(this.hapChar.Brightness, newBright)
          this.cacheBright = newBright
          this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
        }
      }
      if (hasProperty(data.light, 'temperature')) {
        const hkTemp = mr2hkCT(data.light.temperature)

        // Check against the cache and update HomeKit and the cache if needed
        if (this.cacheMired !== hkTemp) {
          const dif = Math.abs(this.cacheMired - hkTemp)
          this.service.updateCharacteristic(this.hapChar.ColorTemperature, hkTemp)
          this.cacheMired = hkTemp
          const kelvin = Math.round(1000000 / this.cacheMired)
          this.accessory.log(`${platformLang.curLightTemp} [${this.cacheMired} / ${kelvin}]`)
          if (dif > 10 && this.alController && this.alController.isAdaptiveLightingActive()) {
            this.alController.disableAdaptiveLighting()
            this.accessory.log(platformLang.alDisabled)
          }
        }
      }
    }
  }
}
