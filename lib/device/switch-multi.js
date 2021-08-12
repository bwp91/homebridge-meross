/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')

module.exports = class deviceSwitchMulti {
  constructor (platform, accessory, devicesInHB) {
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
    this.name = accessory.displayName
    this.pollInterval =
      accessory.context.connection === 'cloud'
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate
    this.priAcc = devicesInHB.get(
      this.platform.api.hap.uuid.generate(accessory.context.serialNumber + '0')
    )

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // Add the switch service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => await this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value

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

    // We only need to setup mqtt client and polling for 'main' accessory (channel 0)
    if (accessory.context.channel === 0) {
      // Set up the mqtt client for cloud devices to send and receive device updates
      if (accessory.context.connection === 'cloud') {
        this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
        this.accessory.mqtt.connect()
      }

      // Always request a device update on startup, then enable polling if user enabled
      this.requestUpdate(true)
      if (this.pollInterval > 0) {
        this.accessory.refreshinterval = setInterval(
          () => this.requestUpdate(),
          this.pollInterval * 1000
        )
      }
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      hideChannels: this.accessory.context.options.hideChannels,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      showAs: 'switch'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.service.getCharacteristic(this.hapChar.On).value) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Get the primary accessory instance to send the command
        const accessory = this.accessory.context.channel === 0 ? this.accessory : this.priAcc

        // Generate the payload and namespace for the correct device model
        const namespace = 'Appliance.Control.ToggleX'
        const payload = {
          togglex: {
            onoff: value ? 1 : 0,
            channel: this.accessory.context.channel
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(accessory, {
          namespace,
          payload
        })

        // Update the cache and log the update has been successful
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }

        // Update the other accessories of this device with the correct status
        switch (this.accessory.context.channel) {
          case 0: {
            // Update all the sub accessories with the same status
            for (let i = 1; i < this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              const hapServ = subAcc.getService(this.hapServ.Switch)
              const hapChar = hapServ.getCharacteristic(this.hapChar.On)
              if (hapChar.value !== value) {
                hapChar.updateValue(value)
                if (subAcc.context.enableLogging) {
                  this.log('[%s] current state [%s].', subAcc.displayName, value ? 'on' : 'off')
                }
              }
            }
            break
          }
          case 1:
          case 2:
          case 3:
          case 4:
          case 5:
          case 6: {
            let primaryState = false
            for (let i = 1; i <= this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              if (i === this.accessory.context.channel) {
                if (value) {
                  primaryState = true
                }
              } else {
                const hapServ = subAcc.getService(this.hapServ.Switch)
                const hapChar = hapServ.getCharacteristic(this.hapChar.On)
                if (hapChar.value) {
                  primaryState = true
                }
              }
            }
            if (!this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
              const hapServ = this.priAcc.getService(this.hapServ.Switch)
              const hapChar = hapServ.getCharacteristic(this.hapChar.On)
              if (hapChar.value !== primaryState) {
                hapChar.updateValue(primaryState)
                if (this.priAcc.context.enableLogging) {
                  this.log(
                    '[%s] current state [%s].',
                    this.priAcc.displayName,
                    primaryState ? 'on' : 'off'
                  )
                }
              }
            }
            break
          }
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] sending update failed as %s.', this.name, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.On,
          this.service.getCharacteristic(this.hapChar.On).value
        )
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
          if (
            data.all.digest &&
            data.all.digest.togglex &&
            Array.isArray(data.all.digest.togglex)
          ) {
            this.applyUpdate(data.all.digest.togglex)
          }

          // A flag to check if we need to update the accessory context
          let needsUpdate = false

          // Get the mac address and hardware version of the device
          if (firstRun && data.all.system) {
            // Mac address, IP and firmware don't change regularly so only get on first poll
            if (data.all.system.hardware) {
              this.cacheMac = data.all.system.hardware.macAddress.toUpperCase()
              this.cacheHardware = data.all.system.hardware.version
            }

            // Get the ip address and firmware of the device
            if (data.all.system.firmware) {
              this.cacheIP = data.all.system.firmware.innerIp
              this.cacheFirmware = data.all.system.firmware.version
            }
          }

          // Get the cloud online status of the device
          if (data.all.system.online) {
            const isOnline = data.all.system.online.status === 1
            if (this.cacheOnline !== isOnline) {
              this.cacheOnline = isOnline
              needsUpdate = true
            }
          }

          // Update the accessory cache if anything has changed
          if (needsUpdate) {
            for (let i = 0; i <= this.accessory.context.channelCount; i++) {
              const subAcc = this.devicesInHB.get(
                this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
              )
              if (!subAcc) {
                continue
              }
              subAcc.context = {
                ...subAcc.context,
                ...{
                  macAddress: this.cacheMac,
                  hardware: this.cacheHardware,
                  ipAddress: this.cacheIP,
                  firmware: this.cacheFirmware,
                  isOnline: this.cacheOnline
                }
              }
              this.platform.updateAccessory(subAcc)
            }
          }
        }
      })
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to request status as %s.', this.name, eText)

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (this.accessory.context.connection === 'local') {
        if (['EHOSTUNREACH', '4000ms exceeded'].some(el => eText.includes(el))) {
          this.cacheOnline = false
          if (this.enableLogging) {
            this.log.warn('[%s] has been reported [offline].', this.name)
          }
          for (let i = 0; i <= this.accessory.context.channelCount; i++) {
            const subAcc = this.devicesInHB.get(
              this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
            )
            if (!subAcc) {
              continue
            }
            subAcc.context.isOnline = false
            this.platform.updateAccessory(subAcc)
          }
        }
      }
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] incoming mqtt: %s.', this.name, JSON.stringify(params))
      }

      // Validate the response, checking for payload property
      if (!params.payload) {
        throw new Error('invalid response received')
      }
      const data = params.payload

      // Check the data is in a format which contains the value we need
      if (data.togglex) {
        // payload.togglex can either be an array of objects (multiple channels) or a single object
        // Either way, push all items into one array
        const toUpdate = []
        if (Array.isArray(data.togglex)) {
          data.togglex.forEach(item => toUpdate.push(item))
        } else {
          toUpdate.push(data.togglex)
        }
        this.applyUpdate(toUpdate)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] failed to refresh status as %s.', this.name, eText)
    }
  }

  applyUpdate (data) {
    data.forEach(channel => {
      // Attempt to find the accessory this channel relates to
      const accessory =
        channel.channel === 0
          ? this.accessory
          : this.devicesInHB.get(
              this.platform.api.hap.uuid.generate(
                this.accessory.context.serialNumber + channel.channel
              )
            )

      // Check the accessory exists
      if (!accessory) {
        return
      }

      // Obtain the service and current value
      const hapServ =
        channel.channel === 0 ? this.service : accessory.getService(this.hapServ.Switch)
      const hapChar = hapServ.getCharacteristic(this.hapChar.On)

      // Read the current state
      const newState = channel.onoff === 1

      // Don't continue if the state is the same as before
      if (hapChar.value === newState) {
        return
      }

      // Update the HomeKit characteristics and log
      hapChar.updateValue(newState)
      if (accessory.context.enableLogging) {
        this.log('[%s] current state [%s].', accessory.displayName, newState ? 'on' : 'off')
      }
    })

    // Check for the primary accessory state
    if (this.platform.hideMasters.includes(this.accessory.context.serialNumber)) {
      return
    }
    let primaryState = false
    for (let i = 1; i <= this.accessory.context.channelCount; i++) {
      const subAcc = this.devicesInHB.get(
        this.platform.api.hap.uuid.generate(this.accessory.context.serialNumber + i)
      )
      if (!subAcc) {
        continue
      }
      if (subAcc.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On).value) {
        primaryState = true
      }
    }
    const hapChar = this.priAcc.getService(this.hapServ.Switch).getCharacteristic(this.hapChar.On)
    if (hapChar.value !== primaryState) {
      hapChar.updateValue(primaryState)
      if (this.priAcc.context.enableLogging) {
        this.log('[%s] current state [%s].', this.priAcc.displayName, primaryState ? 'on' : 'off')
      }
    }
  }
}
