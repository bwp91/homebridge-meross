/* jshint node: true, esversion: 10, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')
const { TimeoutError } = require('p-timeout')

module.exports = class deviceBaby {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
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
      accessory.context.connection !== 'local'
        ? this.funcs.hasProperty(platform.config, 'cloudRefreshRate')
          ? platform.config.cloudRefreshRate
          : platform.consts.defaultValues.cloudRefreshRate
        : this.funcs.hasProperty(platform.config, 'refreshRate')
        ? platform.config.refreshRate
        : platform.consts.defaultValues.refreshRate

    this.channelList = {
      1: 'Cicada Chirping',
      2: 'Rain Sound',
      3: 'Ripple Sound',
      4: 'Birdsong',
      5: 'Lullaby',
      6: 'Fan Sound',
      7: 'Crystal Ball',
      8: 'Music Box',
      9: 'White Noise',
      10: 'Thunder',
      11: 'Ocean Wave'
    }

    // Add the tv service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Television) ||
      this.accessory.addService(this.hapServ.Television)

    // Add the tv speaker service if it doesn't already exist
    this.speakerService =
      this.accessory.getService(this.hapServ.TelevisionSpeaker) ||
      this.accessory.addService(this.hapServ.TelevisionSpeaker)
    this.speakerService
      .updateCharacteristic(this.hapChar.Active, 1)
      .updateCharacteristic(this.hapChar.VolumeControlType, 3)

    // Add the set handler to the tv active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => await this.internalActiveUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value

    // Add the set handler to the switch active identifier characteristic
    this.service
      .getCharacteristic(this.hapChar.ActiveIdentifier)
      .onSet(async value => await this.internalChannelUpdate(value))
    this.cacheChannel = this.service.getCharacteristic(this.hapChar.ActiveIdentifier).value

    // handle volume control
    this.speakerService
      .getCharacteristic(this.hapChar.VolumeSelector)
      .onSet(async value => await this.internalVolumeUpdate(value))
    this.cacheVolume = this.speakerService.getCharacteristic(this.hapChar.VolumeSelector).value

    for (const [id, scene] of Object.entries(this.channelList)) {
      const service =
        this.accessory.getService(scene) ||
        this.accessory.addService(this.hapServ.InputSource, scene, id)
      service
        .setCharacteristic(this.hapChar.Identifier, id)
        .setCharacteristic(this.hapChar.ConfiguredName, scene)
        .setCharacteristic(this.hapChar.IsConfigured, 1)
        .setCharacteristic(this.hapChar.InputSourceType, 3)
      this.service.addLinkedService(service)
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
    if (accessory.context.connection !== 'local') {
      this.accessory.mqtt = new (require('./../connection/mqtt'))(platform, this.accessory)
      this.accessory.mqtt.connect()
    }

    // Always request a device update on startup, then start the interval for polling
    this.requestUpdate(true)
    this.accessory.refreshInterval = setInterval(
      () => this.requestUpdate(),
      this.pollInterval * 1000
    )

    // Output the customised options to the log
    const opts = JSON.stringify({
      connection: this.accessory.context.connection,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  /*
    NOISE MACHINE
    payload: { mp3: { volume: 7, channel: 0, mute: 1, song: 3 } }
    namespace: Appliance.Control.Mp3
      volume: 1-16
      channel: `0
      mute: 0-1
      song: 1-11

      1 - Cicada Chirping
      2 - Rain Sound
      3 - Ripple Sound
      4 - Birdsong
      5 - Lullaby
      6 - Fan Sound
      7 - Crystal Ball
      8 - Music Box
      9 - White Noise
      10 - Thunder
      11 - Ocean Wave
  */

  async internalActiveUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheState) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the namespace and payload
        const namespace = 'Appliance.Control.Mp3'
        const payload = {
          mp3: {
            mute: value
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value === 1 ? 'on' : 'off')
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalChannelUpdate (value) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Don't continue if the state is the same as before
        if (value === this.cacheChannel) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the namespace and payload
        const namespace = 'Appliance.Control.Mp3'
        const payload = {
          mp3: {
            song: value
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache
        this.cacheChannel = value
        if (this.enableLogging) {
          this.log('[%s] current song [%s].', this.name, this.channelList[this.cacheChannel])
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ActiveIdentifier, this.cacheChannel)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalVolumeUpdate (value) {
    this.log.error('SET VolumeSelector: ', value)
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
          this.log('[%s] %s: %s.', this.name, this.lang.incPoll, JSON.stringify(res.data))
        }

        // Check the response is in a useful format
        const data = res.data.payload
        if (data.all) {
          if (data.all.digest && data.all.digest.mp3) {
            this.applyUpdate(data.all.digest.mp3)
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
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      if (this.enableDebugLogging) {
        this.log.warn('[%s] %s %s.', this.name, this.lang.reqFailed, eText)
      }

      // Set the homebridge-ui status of the device to offline if local and error is timeout
      if (
        (this.accessory.context.isOnline || firstRun) &&
        ['EHOSTUNREACH', 'timed out'].some(el => eText.includes(el))
      ) {
        this.accessory.context.isOnline = false
        this.platform.updateAccessory(this.accessory)
      }
    }
  }

  receiveUpdate (params) {
    try {
      // Log the received data
      if (this.enableDebugLogging) {
        this.log('[%s] %s: %s.', this.name, this.lang.incMQTT, JSON.stringify(params))
      }
      if (params.payload && params.payload.mp3) {
        this.applyUpdate(params.payload.mp3)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.refFailed, eText)
    }
  }

  applyUpdate (data) {
    // For TV Active characteristic
    if (data.mute) {
      // Compare to this.cacheState (0, 1)
      if (data.mute !== this.cacheState) {
        this.cacheState = data.mute
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, this.cacheState === 1 ? 'on' : 'off')
        }
      }
    }

    // For TV Speaker Volume characteristic
    if (data.volume) {
      // Compare to this.cacheVolume (0, ..., 100)
      // data.volume is (0, 16)
    }

    // For TV ActiveIdentifier characteristic
    if (data.song) {
      // Compare to this.cacheChannel (1, ..., 11)
      if (data.song !== this.cacheChannel) {
        this.cacheChannel = data.song
        this.service.updateCharacteristic(this.hapChar.ActiveIdentifier, this.cacheChannel)
        if (this.enableLogging) {
          this.log('[%s] current song [%s].', this.name, this.channelList[this.cacheChannel])
        }
      }
    }
  }
}
