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

    // Remove any switch services that are not needed
    if (this.accessory.getService('Open')) {
      this.accessory.removeService(this.accessory.getService('Open'))
    }
    if (this.accessory.getService('Close')) {
      this.accessory.removeService(this.accessory.getService('Close'))
    }
    if (this.accessory.getService('Stop')) {
      this.accessory.removeService(this.accessory.getService('Stop'))
    }

    // Set up the correct service
    let service
    switch (accessory.context.options?.showAs) {
      case 'door':
        service = this.hapServ.Door
        if (this.accessory.getService(this.hapServ.Window)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
        }
        if (this.accessory.getService(this.hapServ.WindowCovering)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
        }
        break
      case 'window':
        service = this.hapServ.Window
        if (this.accessory.getService(this.hapServ.Door)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
        }
        if (this.accessory.getService(this.hapServ.WindowCovering)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.WindowCovering))
        }
        break
      default: // window covering or undefined
        service = this.hapServ.WindowCovering
        if (this.accessory.getService(this.hapServ.Door)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Door))
        }
        if (this.accessory.getService(this.hapServ.Window)) {
          this.accessory.removeService(this.accessory.getService(this.hapServ.Window))
        }
        break
    }

    // Obtain the correct service
    this.service = this.accessory.getService(service) || this.accessory.addService(service)

    // Add the set handler to the selected service
    this.service
      .getCharacteristic(this.hapChar.TargetPosition)
      .onSet(async value => this.internalLocationUpdate(value))

    this.cachePos = this.service.getCharacteristic(this.hapChar.CurrentPosition).value
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.TargetPosition).value

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
      showAs: this.accessory.context.options?.showAs || 'default',
    })
    platform.log('[%s] %s %s.', this.name, platformLang.devInitOpts, opts)
  }

  async internalLocationUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.RollerShutter.Position'
        const payload = {
          position: {
            position: value,
            channel: 0,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache and log the update has been successful
        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}%]`)

        this.isFromHomeKit = true
        setTimeout(() => {
          this.isFromHomeKit = false
        }, 2000)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
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
            if (data.all.digest.position && data.all.digest.state[0]) {
              this.applyUpdate(data.all.digest.state[0])
            }
            if (data.all.digest.position && data.all.digest.position[0]) {
              this.applyUpdate(data.all.digest.position[0])
            }
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
      if (params.payload) {
        if (params.payload.state && params.payload.state[0]) {
          this.applyUpdate(params.payload.state[0])
        }
        if (params.payload.position && params.payload.position[0]) {
          this.applyUpdate(params.payload.position[0])
        }
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    if (hasProperty(data, 'state')) {
      // 0 -> stopped
      // 1 -> opening
      // 2 -> closing
      if (this.cacheState !== data.state) {
        this.cacheState = data.state
        switch (this.cacheState) {
          case 0: {
            // Device has stopped, so the current position is now the target position
            this.cacheTarg = this.cachePos
            this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
            this.service.updateCharacteristic(this.hapChar.PositionState, 2)
            this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}%]`)
            this.accessory.log(`${platformLang.curState} [stopped]`)
            break
          }
          case 1: {
            if (!this.isFromHomeKit) {
              // Device is opening, so hacky set the target position to 100%, don't log this
              this.cacheTarg = 100
              this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
            }
            this.service.updateCharacteristic(this.hapChar.PositionState, 1)
            this.accessory.log(`${platformLang.curState} [opening]`)
            break
          }
          case 2: {
            if (!this.isFromHomeKit) {
              // Device is opening, so hacky set the target position to 0%, don't log this
              this.cacheTarg = 0
              this.service.updateCharacteristic(this.hapChar.TargetPosition, this.cacheTarg)
            }
            this.service.updateCharacteristic(this.hapChar.PositionState, 0)
            this.accessory.log(`${platformLang.curState} [closing]`)
            break
          }
          default: {
            this.accessory.logWarn(`unknown state received [${this.cacheState}], please report on GitHub`)
          }
        }
      }
    }

    if (hasProperty(data, 'position')) {
      if (this.cachePos !== data.position) {
        this.cachePos = data.position
        this.service.updateCharacteristic(this.hapChar.CurrentPosition, this.cachePos)
        this.accessory.log(`${platformLang.curPos} [${this.cachePos}%]`)
      }
    }
  }
}
