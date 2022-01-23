/* jshint node: true, esversion: 10, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const { default: PQueue } = require('p-queue')
const { TimeoutError } = require('p-timeout')

module.exports = class deviceBaby {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
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

    this.volumeHK2MR = input => {
      if (input === 0) {
        return 0
      } else if (input < 7) {
        return 1
      } else if (input < 13) {
        return 2
      } else if (input < 19) {
        return 3
      } else if (input < 25) {
        return 4
      } else if (input < 31) {
        return 5
      } else if (input < 37) {
        return 6
      } else if (input < 43) {
        return 7
      } else if (input < 49) {
        return 8
      } else if (input < 55) {
        return 9
      } else if (input < 61) {
        return 10
      } else if (input < 67) {
        return 11
      } else if (input < 73) {
        return 12
      } else if (input < 79) {
        return 13
      } else if (input < 85) {
        return 14
      } else if (input < 91) {
        return 15
      } else {
        return 16
      }
    }

    this.volumeMR2HK = input => {
      if (input === 16) {
        return 100
      } else {
        return input * 6
      }
    }

    // Add the tv service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Television) ||
      this.accessory.addService(this.hapServ.Television)

    // Remove any old tv speaker services
    if (this.accessory.getService(this.hapServ.TelevisionSpeaker)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.TelevisionSpeaker))
    }

    // Add the tv speaker (fan) service if it doesn't already exist
    this.speakerService =
      this.accessory.getService(this.hapServ.Fan) || this.accessory.addService(this.hapServ.Fan)

    // Add the set handler to the tv active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => await this.internalActiveUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value
    this.cacheStateMR = this.cacheState === 1 ? 0 : 1

    // Add the set handler to the switch active identifier characteristic
    this.service
      .getCharacteristic(this.hapChar.ActiveIdentifier)
      .onSet(async value => await this.internalChannelUpdate(value))
    this.cacheChannel = this.service.getCharacteristic(this.hapChar.ActiveIdentifier).value

    // handle volume control
    this.speakerService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .onSet(async value => await this.internalVolumeUpdate(value))
    this.cacheVolume = this.speakerService.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheVolumeMR = this.volumeHK2MR(this.cacheVolume)

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

    // Add the baby scene custom characteristics
    if (!this.speakerService.testCharacteristic(this.cusChar.BabySceneOne)) {
      this.speakerService.addCharacteristic(this.cusChar.BabySceneOne)
    }
    this.speakerService
      .getCharacteristic(this.cusChar.BabySceneOne)
      .onSet(async value => await this.internalSceneUpdate(value, 3, 'BabySceneOne'))
    if (!this.speakerService.testCharacteristic(this.cusChar.BabySceneTwo)) {
      this.speakerService.addCharacteristic(this.cusChar.BabySceneTwo)
    }
    this.speakerService
      .getCharacteristic(this.cusChar.BabySceneTwo)
      .onSet(async value => await this.internalSceneUpdate(value, 4, 'BabySceneTwo'))
    if (!this.speakerService.testCharacteristic(this.cusChar.BabySceneThree)) {
      this.speakerService.addCharacteristic(this.cusChar.BabySceneThree)
    }
    this.speakerService
      .getCharacteristic(this.cusChar.BabySceneThree)
      .onSet(async value => await this.internalSceneUpdate(value, 1, 'BabySceneThree'))
    if (!this.speakerService.testCharacteristic(this.cusChar.BabySceneFour)) {
      this.speakerService.addCharacteristic(this.cusChar.BabySceneFour)
    }
    this.speakerService
      .getCharacteristic(this.cusChar.BabySceneFour)
      .onSet(async value => await this.internalSceneUpdate(value, 2, 'BabySceneFour'))

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
            mute: value === 1 ? 0 : 1
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache
        this.cacheState = value
        this.cacheStateMR = value === 1 ? 0 : 1
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value === 1 ? 'on' : 'off')
        }

        // Also update the speaker (fan) service
        this.speakerService.updateCharacteristic(this.hapChar.On, value === 1)
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
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // Avoid multiple changes in short space of time
        const updateKey = this.funcs.generateRandomString(5)
        this.updateKey = updateKey
        await this.funcs.sleep(300)
        if (updateKey !== this.updateKey) {
          return
        }

        // Calculate the value Meross needs
        const volumeMR = this.volumeHK2MR(value)

        if (volumeMR === this.cacheVolumeMR) {
          return
        }

        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the namespace and payload
        const namespace = 'Appliance.Control.Mp3'
        const payload = {
          mp3: {
            volume: volumeMR
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache
        this.cacheVolume = value
        this.cacheVolumeMR = volumeMR
        if (this.enableLogging) {
          this.log('[%s] current volume [%s/16].', this.name, this.cacheVolumeMR)
        }
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.speakerService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheVolume)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSceneUpdate (value, scene, charToUpdate) {
    try {
      // Add the request to the queue so updates are send apart
      return await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the namespace and payload
        const namespace = 'Appliance.Control.Light'
        const payload = {
          light: {
            effect: value ? scene : 0,
            channel: 0
          }
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload
        })

        // Update the cache
        if (this.enableLogging) {
          this.log('[%s] current scene [%s].', this.name, value ? scene : 0)
        }

        // Also turn the other scenes off
        ;['BabySceneOne', 'BabySceneTwo', 'BabySceneThree', 'BabySceneFour'].forEach(char => {
          if (char !== charToUpdate) {
            if (this.speakerService.getCharacteristic(this.cusChar[char]).value) {
              this.speakerService.updateCharacteristic(this.cusChar[char], false)
            }
          }
        })
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? this.lang.timeout : this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.sendFailed, eText)
      setTimeout(() => {
        this.speakerService.updateCharacteristic(this.cusChar[charToUpdate], false)
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
    if (this.funcs.hasProperty(data, 'mute')) {
      // Compare to this.cacheState (0, 1)
      if (data.mute !== this.cacheStateMR) {
        this.cacheStateMR = data.mute
        this.cacheState = data.mute === 1 ? 0 : 1
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
        this.speakerService.updateCharacteristic(this.hapChar.On, this.cacheState === 1)
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, this.cacheState === 1 ? 'on' : 'off')
        }
      }
    }

    // For TV Speaker (Fan) characteristic
    if (this.funcs.hasProperty(data, 'volume')) {
      // Compare to this.cacheVolume (0, ..., 100) or better this.cacheVolumeMR (0, 16)
      // data.volume is (0, 16)
      if (data.volume !== this.cacheVolumeMR) {
        this.cacheVolumeMR = data.volume
        this.cacheVolume = this.volumeMR2HK(this.cacheVolumeMR)
        this.speakerService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheVolume)
        if (this.enableLogging) {
          this.log('[%s] current volume [%s/16].', this.name, this.cacheVolumeMR)
        }
      }
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
