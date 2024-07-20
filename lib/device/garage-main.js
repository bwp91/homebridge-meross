import PQueue from 'p-queue'
import { TimeoutError } from 'p-timeout'

import mqttClient from '../connection/mqtt.js'
import platformConsts from '../utils/constants.js'
import { hasProperty, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.devicesInHB = platform.devicesInHB
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
    setTimeout(() => this.requestUpdate(true), 5000)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000,
    )
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
          if (
            data.all.digest
            && data.all.digest.garageDoor
            && Array.isArray(data.all.digest.garageDoor)
          ) {
            data.all.digest.garageDoor.forEach((channel) => {
              // Check whether the homebridge accessory this relates to exists
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(
                  this.accessory.context.serialNumber + channel.channel,
                ),
              )

              // No need to continue if the accessory doesn't exist nor the receiver function
              if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
                return
              }

              // Apply the update to the accessory
              subAcc.control.applyUpdate(channel)
            })
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
            this.devicesInHB.forEach((subAcc) => {
              if (subAcc.context.serialNumber === this.accessory.context.serialNumber) {
                subAcc.context = {
                  ...subAcc.context,

                  macAddress: this.accessory.context.macAddress,
                  hardware: this.accessory.context.hardware,
                  ipAddress: this.accessory.context.ipAddress,
                  firmware: this.accessory.context.firmware,
                  isOnline: this.accessory.context.isOnline
                  ,
                }
                this.platform.updateAccessory(subAcc)
              }
            })
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
        for (let i = 0; i <= this.accessory.context.channelCount; i += 1) {
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i),
          )
          if (subAcc) {
            subAcc.context.isOnline = false
            this.platform.updateAccessory(subAcc)
          }
        }
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

      // Check the data is in a format which contains the value we need
      if (data.state) {
        // data.state maybe array of objects (multiple channels) or a single object
        // Either way, push all items into one array
        const toUpdate = []
        if (Array.isArray(data.state)) {
          data.state.forEach(item => toUpdate.push(item))
        } else {
          toUpdate.push(data.state)
        }

        toUpdate.forEach((channel) => {
          // Check whether the homebridge accessory this relates to exists
          const subAcc = this.devicesInHB.get(
            this.platform.api.hap.uuid.generate(
              this.accessory.context.serialNumber + channel.channel,
            ),
          )

          // No need to continue if the accessory doesn't exist nor the receiver function
          if (!subAcc || !subAcc.control || !subAcc.control.applyUpdate) {
            return
          }

          // Apply the update to the accessory
          subAcc.control.applyUpdate(channel)
        })
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }
}
