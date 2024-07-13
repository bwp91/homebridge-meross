# Change Log

All notable changes to homebridge-meross will be documented in this file.

This project tries to adhere to [Semantic Versioning](http://semver.org/). In practice, this means that the version number will be incremented based on the following:

- `MAJOR` version when a minimum supported version of `homebridge` or `node` is increased to a new major version, or when a breaking change is made to the plugin config
- `MINOR` version when a new device type is added, or when a new feature is added that is backwards-compatible
- `PATCH` version when backwards-compatible bug fixes are implemented

## 10.5.0 (2024-07-13)

### Added

- Support (beta) `MS100F` temperature sensor
- Support (beta) thermostat `MTS960`

### Changed

- Add MSH300HK to IgnoreHKNative in constants.js (#572) (@LWatso99)

## 10.4.1 (2024-07-13)

### Changed

- Fixed for `hap-nodejs` v1.0.0
- Updated dependencies
- Bump `node` recommended versions to v18.20.4 or v20.15.1

## 10.4.0 (2024-03-25)

### Added

- Support `SP425FW`
- Enable Power Strips (#569) (@ZeliardM)
  - Expose multichannel switch/outlet devices as a single HomeKit power strip accessory

### Changed

- Bump `node` supported versions to v18.19.1 or v20.11.1
- Updated dependencies

## 10.3.0 (2023-12-30)

⚠️ Some things of note:

- The recent updates to the plugin are in response to upcoming changes to the Meross API
  - You may have received an email from Meross about this ([#556](https://github.com/bwp91/homebridge-meross/issues/556))
- The plugin will now store your Meross access token (when using cloud/hybrid connection) in the Homebridge storage directory:
  - This allows the plugin to persist your access token between Homebridge restarts
  - The plugin no longer needs to create a login session every time Homebridge starts
  - The plugin should initialise slightly faster when the token is available
  - Users using MFA/2FA on their Meross account will no longer need to update their config every time they restart Homebridge
  - If the stored token has expired, the plugin will attempt once to refresh the token when initialising and store the new one (when MFA/2FA is not enabled on your Meross account)
- If you are using MFA/2FA on your Meross account:
  - You will need to update the plugin config to include the current code from your authenticator app, otherwise the plugin will not be able to log in
  - The code is only valid for 30 seconds, so you will need to update your config and restart Homebridge within this time
  - If your stored access token becomes invalid/expires, you will need to update your config with the current code and restart Homebridge
  - I am unsure right now how long the access token is valid for!

### Added

- persist access token for fewer logins
- config option to show Meross user key in the log when logging in
  - this used to only show when running beta versions of the plugin
  - for some security, this has been made an option in the config rather than always showing it
- auto-redirect http calls for users needing different Meross domain

### Fixed

- device config setup

## 10.2.8 (2023-12-29)

### Changed

- Updated HomeKit native ignore list

### Fixed

- Login issues

## 10.2.7 (2023-12-28)

### Fixed

- Assume local connection when `userkey` is present in config

## 10.2.6 (2023-12-27)

### Changed

- Updated dependencies
- Updated sign-in API

## 10.2.5 (2023-12-25)

### Fixed

- Initialisation issue - incorrectly logging plugin as disabled

## 10.2.4 (2023-12-25)

Merry Christmas! :christmas_tree:

### Fixed

- Fix a setup combination of cloud and local devices

## 10.2.3 (2023-12-24)

### Changed

- API URLs

### Fixed

- Fan device configuration

## 10.2.2 (2023-12-22)

### Fixed

- Added configuration section for thermostat devices

## 10.2.1 (2023-12-22)

### Changed

- Updated HomeKit native ignore list
  - Adding MSS120BR as a HomeKit device (#553) (@djpadz)
  - also added MSS630
- updated dependencies

### Fixed

- fix devices not appearing when forcing local control but credentials still in config
- Mixed case UUIDs are not found in the deviceConf object (#547) (@mrBudgie)

## 10.2.0 (2023-12-15)

### Added

- Support for fan device `MFC100`

### Changed

- Bump `node` supported versions to v18.19.0 or v20.10.0
- Updated dependencies

## 10.1.0 (2023-12-03)

### Added

- Support for `MSS105`, `MSS115`, `MSS120`

### Changed

- Updated HomeKit native ignore list
- Updated Matter native ignore list
- Bump `node` supported versions to v18.18.2 or v20.10.0
- Updated dependencies

## 10.0.0 (2023-10-17)

### Added

- Option to ignore Matter devices (this list will grow over time as users report their Matter devices)

### Changed

- Updated HomeKit native ignore list
- Updated dependencies
- Bump `node` supported versions to v18.18.2 or v20.8.1

### Removed

- Support for node 16

## 9.2.6 (2023-09-18)

⚠️ Note this will be the last version of the plugin to support Node 16.
- Node 16 moves to 'end of life' on 2023-09-11 ([more info](https://nodejs.org/en/blog/announcements/nodejs16-eol))
- This is in-line with the Homebridge guidelines on supporting node versions ([more info](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js/))
- If you are currently using Node 16, now is a good time to upgrade to Node 18 or 20 (see the link above for more info)

### Changed

- Allow roller percentage position for MRS100 hardware version `7.0.0`
- Added template for MFC100 fan controller, although ignored if HK ignore list is set to true

## 9.2.5 (2023-08-28)

### Changed

- Update `axios` to `v1.5.0`

## 9.2.4 (2023-08-26)

### Changed

- Improve error logging for locally configured devices when missing the `model` config property

## 9.2.3 (2023-08-19)

### Changed

- Config UI: changed "Serial Number (UUID)" to "Device UUID" to prevent any confusion about what to enter
  - Also added a description to these fields to explain that these appear in the Homebridge log when the plugin starts
- Bump `node` recommended versions to v16.20.2 or v18.17.1 or v20.5.1

### Fixed

- Also use MRS100 roller positioning for hardware versions `8.0.0`

## 9.2.2 (2023-07-24)

### Changed

- Updated HomeKit native ignore list

## 9.2.1 (2023-07-21)

### Added

- Support for MSS425FC

### Changed

- Bump `node` recommended versions to v16.20.1 or v18.17.0 or v20.5.0

### Fixed

- Leak device status
- Initialisation issue with roller device with location devices

## 9.2.0 (2023-07-18)

### Added

- MSS210P, MSP843P and MSL120DA device support
- Support for MRS100 models that have % position capabilities
- Beta support for: MS400 leak sensor and MTS200 thermostat device

### Changed

- Bump `node` recommended versions to v16.20.1 or v18.16.1 or v20.4.0
- Updated dependencies

Thanks to @ggfunnn, @Rowbby and @DeadlyVirez for help with implementing some of these new device types 🚀

## 9.1.0 (2023-05-01)

### Added

- MSS315 device support

### Changed

- README updates
- Dependency updates

## 9.0.5 (2023-04-22)

### Changed

- Bump `node` supported versions to v16.20.0 or v18.16.0 or v20.0.0
- Updated dependencies

## 9.0.4 (2023-04-20)

### Fixed

- Fix to accommodate Meross API change

## 9.0.3 (2023-04-16)

### Changed

- Fix custom configs for cloud devices
- Reduce minimum `homebridge` version to v1.4
- Bump `node` recommended versions to v16.20.0 or v18.16.0

## 9.0.2 (2023-04-05)

### Changed

- Simplify log welcome messages
- Bump `node` recommended versions to v16.20.0 or v18.15.0

## 9.0.1 (2023-03-11)

### Fixed

- Login issue

## 9.0.0 (2023-03-11)

### Breaking

- Remove official support for Node 14
- Remove option to disable plugin - this is now available in the Homebridge UI
- Remove option for debug logging - this will be enabled when using a beta version of the plugin
- Remove individual accessory logging options to simplify the config

### Added

- Support for:
  - MSS305 outlet (thanks @filipef101!)
  - MSS570M as a dimmer switch
- Support for custom login domain (thanks @filipef101!)

### Changed

- Updated HomeKit native ignore list
- Bump `homebridge` recommended version to v1.6.0 or v2.0.0-beta
- Bump `node` recommended versions to v16.19.1 or v18.15.0
- Updated dependencies

### Fixed

- Fix brightness command for MSL100D

## 8.5.3 (2023-01-24)

### Changed

- Remove debug (error) logging from hubs
- Updated dependencies

## 8.5.2 (2023-01-22)

### Fixed

- Homebridge characteristic warnings for MSH300 hub MS100 subdevices (again!)

## 8.5.1 (2023-01-20)

### Changed

- Updated HomeKit native ignore list
- Updated dependencies

### Fixed

- Homebridge characteristic warnings for MSH300 hub MS100 subdevices

## 8.5.0 (2022-12-18)

### Added

- Support for MSS425ER and MOD150

### Changed

- `MSH300HK` removed from native HomeKit ignore list as there may be subdevices that are not native
  - If this change affects you with an unwanted subdevice appearing, please open an issue
- Allow for homebridge 2.0 beta

### Fixed

- Fixed logic in local model check

## 8.4.0 (2022-11-10)

### Added

- Support for MSL450

### Changed

- Updated HomeKit native ignore list
- Bump `node` recommended versions to v14.21.1 or v16.18.1 or v18.12.1

## 8.3.1 (2022-09-26)

### Fixed

- Node versions in package.json (thanks @eburairu!)

## 8.3.0 (2022-09-25)

### Added

- Support for MTS200B
- Work in progress support for Meross GS559AH smoke alarm

### Changed

- Updated HomeKit native ignore list
- Correct parameters for `updatePlatformAccessories()`
- Updated `homebridge` recommended version to v1.5.0
- Bump `node` recommended versions to v14.20.1 or v16.17.1
- Updated dev dependencies

## 8.2.0 (2022-06-08)

### Added

- **New Devices**
  - Model SP425EW

### Fixed

- A potential issue showing errors in the logs

## 8.1.1 (2022-06-05)

### Changed

- Updated HomeKit native ignore list
- Bump `node` recommended versions to v14.19.3 or v16.15.1

## 8.1.0 (2022-05-29)

### Added

- **New Devices**
  - MSL610 light device

## 8.0.1 (2022-05-28)

### Changed

- More fixes and refactoring

## 8.0.0 (2022-05-28)

### Potentially Breaking Changes

⚠️ The minimum required version of Homebridge is now v1.4.0
⚠️ The minimum required version of Node is now v14

### Changed

- Changed to ESM package
- Bump `node` recommended versions to v14.19.3 or v16.15.0
- Updated HomeKit native ignore list

## 7.10.1 (2022-04-14)

### Fixed

- Cloud login issues

## 7.10.0 (2022-03-29)

### Added

- Support MSS510XR

## 7.9.1 (2022-03-20)

### Changed

- Bump `node` recommended versions to v14.19.1 or v16.14.2
- Bump `axios` to v0.26.1
- Bump `mqtt` to v4.3.7

## 7.9.0 (2022-02-27)

### Added

- Support MSS425EX
- Support MSS120BR

### Changed

- Updated HomeKit native ignore list

## 7.8.1 (2022-02-27)

### Changed

- Updated HomeKit native ignore list
- Bump `axios` to v0.26.0
- Bump `mqtt` to v4.3.6
- Bump `node` recommended versions to v14.19.0 or v16.14.0

## 7.8.0 (2022-02-08)

### Added

- Support MSL120M
- Custom characteristics to Meross Baby Monitor to allow setting of the four light effects
- Template for MTS200 thermostat

### Changed

- Bump `homebridge` recommended version to v1.4.0
- Bump `mqtt` to v4.3.5

## 7.7.0 (2022-01-22)

### Added

- **New Devices**
  - MSS210R added to supported list
- **Sensor Hub Devices**
  - Added option to hide/ignore individual subdevices from Homebridge/HomeKit

### Changed

- Bump `axios` to v0.25.0
- Bump `node` recommended versions to v14.18.3 or v16.13.2

## 7.6.1 (2022-01-08)

### Changed

- Updated HomeKit native ignore list
- Bump `mqtt` to v4.3.4

### Fixed

- Plugin crash for older versions of Homebridge

## 7.6.0 (2022-01-05)

### Added

- **New Devices**
  - HP110A and HP110AHK baby light/sound devices added to supported list
    - This device will be published as an external `Television` service and will need to be added separately to HomeKit
    - It will let you control the on/off state of the sound, change the music and the volume
    - These devices can be configured using the new `babyDevices[]` configuration item
  - MSL320CR added to supported list

### Changed

- Updated HomeKit native ignore list ([PR #390](https://github.com/bwp91/homebridge-meross/pull/390))
- Plugin will log HAPNodeJS version on startup
- Bump `mqtt` to v4.3.2
- Bump `homebridge` recommended version to v1.3.9

## 7.5.0 (2021-12-29)

### Added

- **New Devices**
  - MSS565X added to supported list

### Changed

- Updated HomeKit native ignore list
- Updated dependencies

## 7.4.2 (2021-12-26)

### Changed

- Bump `mqtt` to v4.3.1

### Fixed

- Brightness fix for MSL100R dimmer

## 7.4.1 (2021-12-21)

### Changed

- Some config options rearranged for easier access

## 7.4.0 (2021-12-21)

### Added

- **New Devices**
  - MSS310X added to supported list
  - MSS426F added to supported list
  - MSS510K and MSS510S added to supported list
- **Simulations**
  - Expose a single-channel device as a `Heater` or `Cooler` accessory type, using the current temperature value from another Meross, eWeLink or Govee sensor (eWeLink and Govee sensors will not work with HOOBS)
  - Current temperature values from sensors will be cached in the homebridge storage directory to allow my other plugins to create `Heater` and `Cooler` accessories with the temperature values
- **Configuration**
  - A `connection` option to globally configure which connection type to use (this does **not** take priority over any `connection` option set for an individual device)
  - To clarify the connection methods:
    - **`hybrid`** will attempt local connection first using the IP provided by Meross, if control fails then cloud control will be used (only available when Meross username and password are configured)
    - **`cloud`** will only attempt cloud connection (useful when devices are located on a separate network, only available when Meross username and password are configured)
    - **`local`** will only attempt local connection using a device IP that **must** be configured (available when meross username and password are configured **or** if the Meross userkey is configured)

### Changed

- Plugin will show an error if local control is forced for a device which does not have a manual IP set

### Fixed

- Verify local update for device is for correct device and not different device which has changed IP
- Brightness fix for MSS560M dimmer

## 7.3.1 (2021-12-09)

### Fixed

- A `disabling plugin` notice when just the userkey is configured (issue #376)

## 7.3.0 (2021-12-08)

### Added

- **New Devices**
  - MSXH0 humidifier added to supported list

### Changed

- Plugin will now format and check for valid user key, otherwise will ignore config entry
- Updated HomeKit native ignore list
- Bump `homebridge` recommended version to v1.3.8
- Bump `node` recommended versions to v14.18.2 or v16.13.1

### Fixed

- `messageId` increased from 16 to 32 random characters, appears to fix local control for newer device firmware

## 7.2.0 (2021-11-03)

### Added

- **New Devices**
  - MDL110 added to supported list
  - MSL120DBR added to supported list
  - MSS110NR added to supported list

### Changed

- Updated HomeKit native ignore list

## 7.1.2 (2021-10-31)

### Changed

- Updated HomeKit native ignore list

## 7.1.1 (2021-10-27)

### Changed

- Bump `node` recommended versions to v14.18.1 or v16.13.0
- Bump `axios` to v0.24.0

### Fixed

- Fixed an issue for HOOBS users related to the fakegato library

## 7.1.0 (2021-10-20)

### Added

- **New Devices**
  - MSS560M added to supported list

### Fixed

- An Eve app 'no data' gap for garage devices when restarting the plugin

## 7.0.0 (2021-10-16)

### Added

**See ⚠️ for breaking changes**

- **New Devices**
  - MSH300HK added to supported list
  - MSL320CPR added to supported list
  - MSS426 added to supported list
  - MSS620R added to supported list
  - MTS150 added to supported list
- **Configuration**
  - A `connection` option per device to choose between
    - `default` (hybrid) - the plugin will attempt local control with the provided IP, and revert to cloud control if necessary
    - `cloud` - local control will be skipped and the plugin will force cloud control
    - `local` - the plugin will only attempt local control (the device IP must be configured)

### Changed

- ⚠️ For devices currently using cloud control, the plugin will now first attempt to control the device locally using the network IP provided by Meross. If this local attempt fails for any reason, the plugin will revert to cloud control as before.
- Updated HomeKit native ignore list
- Supply more information to the log about an unsupported MSH300 subdevice
- Recommended node versions bumped to v14.18.1 or v16.11.1
- Recommended Homebridge bumped to v1.3.5
- Bump `axios` to v0.23.0

### Fixed

- An issue showing Eve historical data for garage doors
- An error when trying to unregister a hidden accessory from Homebridge

### Removed

- ⚠️ The deprecated `devices` setting has been removed
- ⚠️ `hybridMode` setting has been removed

## 6.13.2 (2021-10-03)

### Changed

- Small changes to RGB light devices
- Bump `axios` to v0.22.0

## 6.13.1 (2021-09-30)

### Changed

- Recommended node versions bumped to v14.18.0 or v16.10.0

### Fixed

- Increased MSS426S channel count from 6 to 7
- Fixed a purifier speed mapping issue

## 6.13.0 (2021-09-28)

### Added

- **New Devices**
  - MAP100 purifier added to supported list
  - MSS426S added to supported list

### Changed

- Updated HomeKit native ignore list

## 6.12.0 (2021-09-14)

### Added

- **New Devices**
  - MSS620BR added to supported list
  - MSS710R added to supported list

### Fixed

- GitHub issue link for devices awaiting support

## 6.11.0 (2021-09-09)

### Added

- **New Devices**
  - MTS100 added to supported list (MTS100V3)

### Changed

- `configureAccessory` function simplified to reduce chance of accessory cache retrieval failing
- Bump `axios` to v0.21.4

### Fixed

- Colour (rgb, cct) functions for supported bulbs (including response times and adaptive lighting)

## 6.10.0 (2021-09-05)

### Added

- **New Devices**
  - MDL110M added to supported list (unconfirmed working)
  - MSS110RTL added to supported list

### Changed

- Updated HomeKit native ignore list
- Recommended node version bumped to v14.17.6
- Bump `axios` to v0.21.3

## 6.9.2 (2021-08-30)

### Changed

- Updated HomeKit native ignore list

### Fixed

- An issue preventing MSG200 from polling for status

## 6.9.1 (2021-08-27)

### Changed

- Make timeout error logging more consistent

### Fixed

- An issue displaying the correct status of MSG100/MSG200
- An issue that disabled the plugin when the initial http connection failed

## 6.9.0 (2021-08-25)

### Added

- **New Devices**
  - MSS210RTL added to supported list
  - MSL320CP added to supported list

### Changed

- More understandable logging on timeout when controlling a device
- Use `p-timeout` instead of `promise-timeout` for mqtt timeout

### Fixed

- An issue initialising a multichannel device when the main accessory has been hidden

## 6.8.0 (2021-08-22)

### Added

- **Configuration**
  - Option to globally ignore and remove HomeKit-native devices (for a small number of models so far, work in progress)
- **New Devices**
  - MSL320C added to supported list

### Changed

- Polling errors will now only be shown in debug mode (offline/online entries will still show, as will errors when controlling a device)

### Fixed

- Attempt to fix a couple of small issues when controlling MOD100 diffuser
- Fix a `ResetTotal` characteristic warning for single-channel outlets

## 6.7.2 (2021-08-17)

### Fixed

- Fixed a polling issue for the MRS100
- Fixed repeated `reported [offline]` messages for local devices

## 6.7.1 (2021-08-17)

### Fixed

- Fixed a `Cannot read property 'LastActivation' of undefined` issue

## 6.7.0 (2021-08-16)

### Added

- **Eve History**
  - For single-channel outlets that have energy monitoring, historical power data is now available, along with an approximate total consumption (kWh) value
  - For garage devices, history data available - last opening time and open count
  - For MS100 sensors, graphs will show with historical temperature and humidity values
- **New Devices**
  - MSL120J added to supported list

## 6.6.0 (2021-08-12)

### Added

- **Hybrid Mode**
  - This mode can be turned on from the 'Optional Settings' section of the config
  - If a local IP for a cloud device is provided by Meross, then the plugin will attempt to control the device locally. If this fails for any reason then the request will be sent via the cloud as before
  - I would eventually like to remove this option and have this hard-coded as _the way_ the plugin works, but I don't want to make a breaking change for now
- **New Devices**
  - MSL100R added to supported list
  - MSL120DR added to supported list
  - MSS120B added to supported list
- **All Devices**
  - Set a user key _per_ device, can be useful if the device is registered to a different Meross account that defined in the 'Optional Settings'
  - Initial device information will be displayed in the log when an accessory initialises and debug mode is on
- **Eve History**
  - On/Off history graphs added for single and multichannel devices when exposed as `Switch`

### Changed

- **All Devices**
  - Option to disable polling has been removed in order to keep cloud device IPs up to date. Cloud and local polling now has a maximum interval of 10 minutes, and if option is set to `0` then this will be increased to 10 minutes.
  - Cloud device IP will now be checked and updated if necessary on every poll run
- **Multi-Channel Devices**
  - Meross channel names will be used for sub-accessories if provided by cloud
- **Garage Devices**
  - ⚠️ MSG200 will now show a separate garage door accessory for the three available channels, you can use the configuration to hide any of the channels you don't use or don't want visible in Homebridge
  - For local devices, when closing garage via HomeKit, the plugin will poll every 3 seconds for status update until either the garage has closed or 15 seconds after the configured operation time when the garage will be marked as open again
- **Plugin UI**
  - Credentials settings moved out of 'Optional Settings' section
  - Some unnecessary placeholders removed
- **Platform Versions**
  - Recommended node version bumped to v14.17.5

### Fixed

- **All Devices**
  - Plugin did not use default `cloudRefreshRate` or `refreshRate` if not configured by the user
- **Multi-Channel Devices**
  - Information like firmware, IP and mac address will now show properly in the Homebridge UI, sometimes this info would not be properly saved by the plugin
  - Hidden sub-accessories will no longer be added as hidden Homebridge accessories

### Removed

- **Plugin UI**
  - Device URL and firmware override options for 'Sensor Devices', at least temporarily, whilst local mode is not supported for the MSH300

## 6.5.0 (2021-08-05)

### Added

- **New Devices**
  - MSS560X added to supported list

## 6.4.0 (2021-08-04)

### Added

- **New Devices**
  - MSS110R added to supported list
  - MSS510H added to supported list

### Changed

- Changed 'Manufacturer' from 'Meross' to 'Meross Technology'
  - This should fix **future** cases of false 'firmware update' alerts
  - Existing accessories will need to be removed from the cache, so they are re-added with this new manufacturer
- **Diffusers & Light Devices**
  - Removed cloud polling force override as real-time updates are now available for these devices
- **Configuration**
  - The `model` field in the device sections will only show for local devices (not needed for cloud devices)

## 6.3.0 (2021-08-03)

### Added

- **Configuration**
  - The plugin settings screen now splits up the 'Device Settings' into different sections
    - You should consider moving the entries from the 'Devices Settings' section (at the bottom) to the appropriate section above
    - No breaking change has been made, but in a future version of the plugin I would like to remove the general 'Device Settings' section
    - Extra configuration options that have been added in this release and in the future will only appear in the specific section to the device type, not the previous 'Device Settings' section
- **All Devices**
  - Plugin will log the user-configurable options and values per accessory when devices are initialised on startup
- **Single-Channel Devices**
  - Added option to expose as an `AirPurifier` homekit accessory type (nice to look at in the home app if by chance you have a purifier connected to an outlet)
- **Light Devices**
  - Added 'Brightness Step' option to specify a step-size on the brightness slider
  - Added 'Adaptive Lighting Shift' option to specify a mired-shift, also can be used to remove the adaptive lighting feature
- **Diffuser Devices**
  - Added 'Brightness Step' option to specify a step-size on the brightness slider
- **New Devices**
  - MSL320M added to supported list
  - MSS550L added to supported list
  - MPD100 (re)added to supported list as a dimmer device
  - Support for MS100 sensor/humidity devices via the MSH300
    - Note that cloud connection is necessary to obtain a subdevice list for the hub

### Changed

- **Light Devices**
  - Plugin will update status (when controlled externally) in real time for cloud devices
- **Diffuser Devices**
  - Plugin will update status (when controlled externally) in real time for cloud devices
  - Set logging level back to user-defined now that it's working

### Fixed

- **Light Devices**
  - Fixed a `this.colourUtils.mr2hk is not a function` issue

## 6.2.0 (2021-08-01)

### Added

- **All Devices**
  - Device online/offline status in the Homebridge log
  - Plugin will show a local device as offline in the plugin ui if the polling has failed due to timeout or `EHOSTUNREACH` (unreachable, normally means the device has lost Wi-Fi connection)
- **Diffusers**
  - Switch between 'colour', 'rainbow' and 'temperature' modes using Eve-only characteristics (create scenes in the Eve app that will appear in the Home app)
- **Single-Channel Outlets**
  - Plugin will now poll every minute for power data for devices that offer this feature (plugin will attempt to check automatically)
  - Current wattage and voltage is available to see in the Eve app
  - Plugin will set the HomeKit 'In Use' status to 'Yes' if the outlet is on and the wattage is above a configurable value
    - This can be useful to set up automations in the Eve app based on whether the wattage has risen above or dropped below a certain value

### Changed

- **Configuration**
  - Plugin will disable if neither of username & password nor user key has been configured
  - Device `connection` setting has been removed, plugin will instead check for a configured `deviceUrl` to determine connection mode
- **Light Devices**
  - ⚠️ On/Off light switches will now be exposed as a `Switch` accessory type (you can change to show it as a light in the Home app, or a fan for the sake of it!)

### Fixed

- **Multi-Channel Outlets**
  - An issue preventing multichannel devices from updating from polled data when exposed as outlets
  - The Homebridge UI will now show the correct status for sub-accessories of a multichannel device
- **Light Devices**
  - Reinstate 'lost' support for MSL120B
- **Diffusers**
  - Bugfixes for MOD-100

## 6.1.1 (2021-07-29)

### Fixed

- An issue preventing local devices from initialising

## 6.1.0 (2021-07-29)

### Added

- **Homebridge UI**
  - More information on the devices tab: connection status, IP address, MAC address and hardware & firmware version
- **New Devices**
  - Initial support for the MOD-100 diffuser - only light control at this stage
- **Configuration**
  - Plugin will now check for duplicate device ID entries in the config and ignore them

### Changed

- ⚠️ **Platform Versions**
  - Recommended node version bumped to v14.17.4
  - Recommended homebridge version bumped to v1.3.4
- **Single Channel Devices**
  - The plugin will try to auto-detect whether 'Toggle' or 'ToggleX' namespace is used

## 6.0.0 (2021-07-28)

### Important Note

- This new release changes the way that locally controlled devices are managed/configured
- It also brings in the functionality of `homebridge-meross-cloud` plugin
- When updating from v5, your HomeKit accessories will most likely be reset (due to config changes)
- It is recommended to use the Homebridge/HOOBS UI to reconfigure your locally controlled devices
- See the full change log below for more details

### Added

- **Cloud Control**
  - Support for cloud devices (bringing the functionality of `homebridge-meross-cloud` into this plugin)
  - Device MQTT connections so any external changes to devices should be reflected in HomeKit in real time
    - This makes cloud polling no longer necessary, so is now disabled by default, you can re-enable this in the plugin settings
- **Local Control**
  - The use of an account key for local device control
    - The key will automatically be obtained if your Meross credentials are present
    - Docs to find this account key are available in the wiki
    - The use of this account key makes the device `messageId`, `sign` and `timestamp` redundant and these options have been removed
    - It is necessary to also configure the serial number (uuid) per the device in the configuration
    - **⚠️ Your local devices will not work with this version unless you configure the account key and serial number (uuid)**
- **New Devices**
  - MSG100 cloud support added
  - MRS100 cloud and local support added
- **Adaptive Lighting**
  - Adaptive Lighting for supported light bulbs
- **Logging**
  - Logging level on a per-accessory basis, which can be helpful when wanting to debug a specific accessory
- **Configuration Validation**
  - More configuration validation, logging if you have entries that are incorrectly configured or unused
- **No Response Label**
  - Promise-based device control, so the plugin should show a device as 'No Response' if controlling an accessory has failed

### Changed

- ⚠️ All switch/outlet devices will be now exposed to HomeKit by default as a `Switch` (both cloud and local devices)
  - A new configuration setting has been added if you prefer for your device to be exposed as an `Outlet`
- ⚠️ Cloud multi-channel devices will now appear as separate accessories
  - An extra 'All On/Off' accessory will be shown in HomeKit
  - You can use the 'Hide Channels' setting to hide channels you don't use, including the 'All On/Off' accessory

## 5.0.3 (2021-06-15)

### Changed

- Housekeeping and updated dependencies.

## 5.0.2 (2020-03-25)

### Changed

- Fixed an issue where MSL-120 payload fails to be read.
- Updated dependencies.

## 5.0.1 (2020-03-19)

### Changed

- Fixed an issue with `config.schema.json` where it wouldn't save changes to `refreshRate`.
- Added the ability to enter a custom value for `garageDoorOpeningTime`.
- Updated dependencies.

## 5.0.0 (2021-03-14)

### Breaking Changes

- The Plugin has been changed from an `accessory` type to a `platform` type.
- You will have to change you config completely if you update to this version.
  - You can take your current `accessory` and move it to the platform config.
  - See (Specific Model Configurations)[https://github.com/homebridge-plugins/homebridge-meross/wiki/Specific-Model-Configurations] Wiki for more examples.
  - Example:
  #### Before:
  ```json
  "accessories": [
      {
        "model": "MSS620",
        "name": "Outlet",
        "deviceUrl": "192.168.1.1",
        "channel": 0,
        "messageId": "abcdefghijklmnopqrstuvwxyz123456789",
        "timestamp": 123456789,
        "sign": "abcdefghijklmnopqrstuvwxyz123456789",
        "accessory": "Meross"
      }
  ]
  ```
  #### After:
  ```json
  "platforms": [
      {
      "name": "Meross",
      "devices": [
          <This_is_from_above>
          {
          "model": "MSS620",
          "name": "Outlet",
          "deviceUrl": "192.168.1.1",
          "channel": 0,
          "messageId": "abcdefghijklmnopqrstuvwxyz123456789",
          "timestamp": 123456789,
          "sign": "abcdefghijklmnopqrstuvwxyz123456789",
          "accessory": "Meross" <You_Can_Remove_This.>
          }
          <Ends_here_from_above>
        ],
      "platform": "Meross"
      }
  ]
  ```
- Added Config for Refresh Rate.
  - default is 5 seconds and if updating to often can be set in the config.

## 4.0.1 (2020-03-12)

### Changed

- Fixes a bug that does not retrieve the status of an outlet device.

## 4.0.0 (2021-03-02)

### Major Changes

- Homebridge support has moved to v1.3.1
  - Homebridge v1.3.1 must be installed before updating to this version.
  - Support for the new onGet/onSet introduced in Homebridge v1.3.0.

### Changed

- Adding in MSL-320

## 3.5.0 (2021-02-13)

### Changed

- Add support for MSL-420 (#167), Thanks @123marvin123!
- Fixed MSS110-1 and MSS110-2 Type Error (#170), Thanks @MrJer!
- Adds support for MSS630 device (#196), Thanks @rcoletti116!

## 3.4.1 (2020-12-19)

### Changed

- Add option to change accessory `Firmware Revision` and `Serial Number`.
  - This fixes [#121](https://github.com/homebridge-plugins/homebridge-meross/issues/121) - `HomeKit showing as "Update Available"`.

## 3.4.0 (2020-11-19)

### Changed

- Add preliminary support for MSG200.
  - Minor changes to support channels with the garage door opener, has been tested with the MSG100 and MSG200.
  - The MSG100 uses channel 0, for the single door, but the MSG200 uses channels 1, 2, and 3.
  - FWIW, setting channel 0 on the MSG200 to open or closed appears to control all doors.

## 3.3.0 (2020-11-06)

### Changed

- Added basic support for MSL-100, MSL-120.

## 3.2.0 (2020-10-15)

### Changed

- Added support for the MSS530H.
  - You set an ChannelID 1, 2 or 3.
    - Channel 1 is the Top Outlet.
    - Channel 2 the bottom left.
    - Channel 3 the bottom right.

## 3.1.0 (2020-10-02)

### Changed

- Added brightness changing support to the MSS560 switch.

## 3.0.0 (2020-09-17)

### Changed

- Converted Project to Typescript.

## 2.3.1 (2020-07-21)

### Changed

- Change garage door status check interval to 5s.

## 2.3.0 (2020-06-22)

### Changed

- Get garage door status change notification by requesting status every 2s all the time. (#41) Thanks CocoaBob!

## 2.2.0 (2020-06-16)

### Changed

- Add support for garage door opening time parameter. (#36) Thanks CocoaBob!

## 2.1.0 (2020-04-13)

### Changed

- Changed Log to only display On & Off States.
- Compressed all other logging to debug.
  - To View This logging, turn on Homebridge Debug (-D) in Homebridge Settings of Config UI X.

## 2.0.0 (2020-05-27)

### Changed

- added Support for MSG-100 (Garage Door Opener).

## IMPORTANT

### Homebridge v1.0.0

- Changed homebridge requirement to be v1.0.0 or higher.

## 1.1.0 (2020-04-13)

### Changed

- Update config.schema.json with specific models that are supported.
- Changed requirements for specific models on what fields are needed.
- Added helpful wiki links to repo

# IMPORTANT

### Change to Config Needed!

- We have replaced the `hardware revision` with `model`.
- We also changed the `deviceUrl` to only require the device IP Address.
- You will have to change your config to match the new config.schema.json layout.

## 1.0.4 (2020-04-13)

### Changed

- fix config.schema.json

## 1.0.3 (2020-04-13)

### Changed

- fix config.schema.json
- update engine dependencies

## 1.0.2 (2020-04-11)

### Changed

- remove devDependencies homebridge-config-ui-x and homebridge
- update engine dependencies

## 1.0.1 (2020-04-08)

### Changed

- Update devDependencies homebridge-config-ui-x and homebridge

## 1.0.0 (2020-04-06)

### Changed

- Update Readme

## 0.1.0 (2020-03-21)

### Changed

- Bump request from 2.88.0 to 2.88.2 [#8](https://github.com/homebridge-plugins/homebridge-meross/pull/8)

## 0.0.8 (2020-01-30)

### Changed

- Fixed config.schema.json

## 0.0.7 (2020-01-30)

### Changed

- Update dependencies

## 0.0.6 (2020-01-30)

### Changed

- Allowing for multiple devices.
