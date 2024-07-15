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

export default class {
  constructor(platform, accessory, accessoryLight) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.accessoryLight = accessoryLight
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
      11: 'Ocean Wave',
    }

    this.volumeHK2MR = (input) => {
      if (input === 0) {
        return 0
      }
      if (input < 7) {
        return 1
      }
      if (input < 13) {
        return 2
      }
      if (input < 19) {
        return 3
      }
      if (input < 25) {
        return 4
      }
      if (input < 31) {
        return 5
      }
      if (input < 37) {
        return 6
      }
      if (input < 43) {
        return 7
      }
      if (input < 49) {
        return 8
      }
      if (input < 55) {
        return 9
      }
      if (input < 61) {
        return 10
      }
      if (input < 67) {
        return 11
      }
      if (input < 73) {
        return 12
      }
      if (input < 79) {
        return 13
      }
      if (input < 85) {
        return 14
      }
      if (input < 91) {
        return 15
      }
      return 16
    }

    this.volumeMR2HK = (input) => {
      if (input === 16) {
        return 100
      }
      return input * 6
    }

    // Add the tv service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Television)
    || this.accessory.addService(this.hapServ.Television)

    // Add a lightbulb service to the light accessory if it doesn't exist
    this.serviceLight = this.accessoryLight.getService(this.hapServ.Lightbulb)
    || this.accessoryLight.addService(this.hapServ.Lightbulb)

    // Remove any old tv speaker services
    if (this.accessory.getService(this.hapServ.TelevisionSpeaker)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.TelevisionSpeaker))
    }

    // Add the tv speaker (fan) service if it doesn't already exist
    this.speakerService = this.accessory.getService(this.hapServ.Fan) || this.accessory.addService(this.hapServ.Fan)

    // Add the set handler to the tv active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalActiveUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value
    this.cacheStateMR = this.cacheState === 1 ? 0 : 1

    // Add the set handler to the switch active identifier characteristic
    this.service
      .getCharacteristic(this.hapChar.ActiveIdentifier)
      .onSet(async value => this.internalChannelUpdate(value))
    this.cacheChannel = this.service.getCharacteristic(this.hapChar.ActiveIdentifier).value

    // Handle volume control
    this.speakerService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .onSet(async value => this.internalVolumeUpdate(value))
    this.cacheVolume = this.speakerService.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheVolumeMR = this.volumeHK2MR(this.cacheVolume)

    Object.entries(this.channelList).forEach((entry) => {
      const [id, scene] = entry
      const service = this.accessory.getService(scene)
        || this.accessory.addService(this.hapServ.InputSource, scene, id)
      service
        .setCharacteristic(this.hapChar.Identifier, id)
        .setCharacteristic(this.hapChar.ConfiguredName, scene)
        .setCharacteristic(this.hapChar.IsConfigured, 1)
        .setCharacteristic(this.hapChar.InputSourceType, 3)
      this.service.addLinkedService(service)
    })

    // Add the baby scene custom characteristics
    if (!this.serviceLight.testCharacteristic(this.cusChar.BabySceneOne)) {
      this.serviceLight.addCharacteristic(this.cusChar.BabySceneOne)
    }
    this.serviceLight
      .getCharacteristic(this.cusChar.BabySceneOne)
      .onSet(async value => this.internalSceneUpdate(value, 3, 'BabySceneOne'))
    if (!this.serviceLight.testCharacteristic(this.cusChar.BabySceneTwo)) {
      this.serviceLight.addCharacteristic(this.cusChar.BabySceneTwo)
    }
    this.serviceLight
      .getCharacteristic(this.cusChar.BabySceneTwo)
      .onSet(async value => this.internalSceneUpdate(value, 4, 'BabySceneTwo'))
    if (!this.serviceLight.testCharacteristic(this.cusChar.BabySceneThree)) {
      this.serviceLight.addCharacteristic(this.cusChar.BabySceneThree)
    }
    this.serviceLight
      .getCharacteristic(this.cusChar.BabySceneThree)
      .onSet(async value => this.internalSceneUpdate(value, 1, 'BabySceneThree'))
    if (!this.serviceLight.testCharacteristic(this.cusChar.BabySceneFour)) {
      this.serviceLight.addCharacteristic(this.cusChar.BabySceneFour)
    }
    this.serviceLight
      .getCharacteristic(this.cusChar.BabySceneFour)
      .onSet(async value => this.internalSceneUpdate(value, 2, 'BabySceneFour'))

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

  async internalActiveUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
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
            mute: value === 1 ? 0 : 1,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache
        this.cacheState = value
        this.cacheStateMR = value === 1 ? 0 : 1
        this.accessory.log(`${platformLang.curState} [${value === 1 ? 'on' : 'off'}]`)

        // Also update the speaker (fan) service
        this.speakerService.updateCharacteristic(this.hapChar.On, value === 1)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalChannelUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
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
            song: value,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache
        this.cacheChannel = value
        this.accessory.log(`${platformLang.curSong} [${this.channelList[this.cacheChannel]}]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ActiveIdentifier, this.cacheChannel)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalVolumeUpdate(value) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // Avoid multiple changes in short space of time
        const updateKey = generateRandomString(5)
        this.updateKey = updateKey
        await sleep(300)
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
            volume: volumeMR,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache
        this.cacheVolume = value
        this.cacheVolumeMR = volumeMR

        this.accessory.log(`${platformLang.curVol} [${this.cacheVolumeMR}/16]`)
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.speakerService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheVolume)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSceneUpdate(value, scene, charToUpdate) {
    try {
      // Add the request to the queue so updates are sent apart
      await this.queue.add(async () => {
        // This flag stops the plugin from requesting updates while pending on others
        this.updateInProgress = true

        // Generate the namespace and payload
        const namespace = 'Appliance.Control.Light'
        const payload = {
          light: {
            effect: value ? scene : 0,
            channel: 0,
          },
        }

        // Use the platform function to send the update to the device
        await this.platform.sendUpdate(this.accessory, {
          namespace,
          payload,
        })

        // Update the cache
        this.accessory.log(`${platformLang.curScene} [${value ? scene : 0}]`);

        // Also turn the other scenes off
        ['BabySceneOne', 'BabySceneTwo', 'BabySceneThree', 'BabySceneFour'].forEach((char) => {
          if (char !== charToUpdate) {
            if (this.serviceLight.getCharacteristic(this.cusChar[char]).value) {
              this.serviceLight.updateCharacteristic(this.cusChar[char], false)
            }
          }
        })
      })
    } catch (err) {
      // Catch any errors whilst updating the device
      const eText = err instanceof TimeoutError ? platformLang.timeout : parseError(err)
      this.accessory.logWarn(`${platformLang.sendFailed} ${eText}`)
      setTimeout(() => {
        this.serviceLight.updateCharacteristic(this.cusChar[charToUpdate], false)
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
      if (params.payload && params.payload.mp3) {
        this.applyUpdate(params.payload.mp3)
      }
    } catch (err) {
      this.accessory.logWarn(`${platformLang.refFailed} ${parseError(err)}`)
    }
  }

  applyUpdate(data) {
    // For TV Active characteristic
    if (hasProperty(data, 'mute')) {
      // Compare to this.cacheState (0, 1)
      if (data.mute !== this.cacheStateMR) {
        this.cacheStateMR = data.mute
        this.cacheState = data.mute === 1 ? 0 : 1
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
        this.speakerService.updateCharacteristic(this.hapChar.On, this.cacheState === 1)
        this.accessory.log(`${platformLang.curState} [${this.cacheState === 1 ? 'on' : 'off'}]`)
      }
    }

    // For TV Speaker (Fan) characteristic
    if (hasProperty(data, 'volume')) {
      // Compare to this.cacheVolume (0, ..., 100) or better this.cacheVolumeMR (0, 16)
      // data.volume is (0, 16)
      if (data.volume !== this.cacheVolumeMR) {
        this.cacheVolumeMR = data.volume
        this.cacheVolume = this.volumeMR2HK(this.cacheVolumeMR)
        this.speakerService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheVolume)
        this.accessory.log(`${platformLang.curVol} [${this.cacheVolumeMR}/16].`)
      }
    }

    // For TV ActiveIdentifier characteristic
    if (data.song) {
      // Compare to this.cacheChannel (1, ..., 11)
      if (data.song !== this.cacheChannel) {
        this.cacheChannel = data.song
        this.service.updateCharacteristic(this.hapChar.ActiveIdentifier, this.cacheChannel)
        this.accessory.log(`${platformLang.curSong} [${this.channelList[this.cacheChannel]}]`)
      }
    }
  }
}
