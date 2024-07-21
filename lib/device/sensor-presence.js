import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'

import mqttClient from '../connection/mqtt.js'
import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

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

    this.value2Label = (value) => {
      switch (value) {
        case 1: return 'absence'
        case 2: return 'presence'
        case 3: return 'minor motion'
        case 4: return 'motion'
        case 5: return 'approach'
        case 6: return 'moving away'
        default: return 'unknown'
      }
    }

    // Add an occupancy sensor if it doesn't already exist
    this.occupancyService = this.accessory.getService(this.hapServ.OccupancySensor)
    || this.accessory.addService(this.hapServ.OccupancySensor)
    this.cacheOccupancy = this.occupancyService.getCharacteristic(this.hapChar.OccupancyDetected).value

    // Add the light sensor if it doesn't already exist
    this.lightService = this.accessory.getService(this.hapServ.LightSensor)
    || this.accessory.addService(this.hapServ.LightSensor)
    this.cacheLux = this.lightService.getCharacteristic(this.hapChar.CurrentAmbientLightLevel).value

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
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
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
        this.accessory.logWarn(`${platformLang.incPoll}: ${JSON.stringify(res.data)}`)

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all) {
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
      this.accessory.logWarn(`${platformLang.incMQTT}: ${JSON.stringify(params)}`)
      if (params.payload?.latest?.[0]?.data) {
        this.applyUpdate(params.payload.latest[0].data)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    if (data.light?.[0]?.value) {
      // Check against the cache and update HomeKit and the cache if needed
      const newLux = data.light[0].value
      if (this.cacheLux !== newLux) {
        this.lightService.updateCharacteristic(this.hapChar.CurrentAmbientLightLevel, newLux)
        this.cacheLux = newLux
        this.accessory.log(`${platformLang.curLux} [${newLux}]`)
      }
    }

    if (data.presence?.[0]?.value && data.presence[0].value !== this.cacheOccupancyRaw) {
      this.cacheOccupancyRaw = data.presence[0].value

      // Check against the cache and update HomeKit and the cache if needed
      const newOccupancy = this.cacheOccupancyRaw !== 1 ? 1 : 0
      if (this.cacheOccupancy !== newOccupancy) {
        this.occupancyService.updateCharacteristic(this.hapChar.OccupancyDetected, newOccupancy)
        this.cacheOccupancy = newOccupancy
      }

      this.accessory.log(`${platformLang.curOcc} [${this.value2Label(this.cacheOccupancyRaw)}]`)
    }
  }
}
