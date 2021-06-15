# Change Log

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## [Version 5.0.3](https://github.com/homebridge-plugins/homebridge-meross/compare/v5.0.2....5.0.3) (2021-06-15)

### Changes

- Housekeeping and updated dependencies.

## [Version 5.0.2](https://github.com/homebridge-plugins/homebridge-meross/compare/v5.0.1....5.0.2) (2020-03-25)

### Changes

- Fixed an issue where MSL-120 payload fails to be read.
- Updated dependencies.

## [Version 5.0.1](https://github.com/homebridge-plugins/homebridge-meross/compare/v5.0.0....5.0.1) (2020-03-19)

### Changes

- Fixed an issue with `config.schema.json` where it wouldn't save changes to `refreshRate`.
- Added the ability to enter a custom value for `garageDoorOpeningTime`.
- Updated dependencies.

## [Version 5.0.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v4.0.0....5.0.0) (2021-03-14)

### Breaking Changes

- The Plugin has been been changed from an `accessory` type to a `platform` type.
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

## [Version 4.0.1](https://github.com/homebridge-plugins/homebridge-meross/compare/v4.0.0....4.0.1) (2020-03-12)

### Changes

- Fixes a bug that does not retrieve the status of an outlet device.

## [Version 4.0.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.5.0....4.0.0) (2021-03-02)

### Major Changes

- Homebridge support has moved to v1.3.1
  - Homebridge v1.3.1 must be installed before updating to this version.
  - Support for the new onGet/onSet introdcued in Homebridge v1.3.0.

### Changes

- Adding in MSL-320

## [Version 3.5.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.4.1....3.5.0) (2021-02-13)

### Changes

- Add support for MSL-420 (#167), Thanks @123marvin123!
- Fixed MSS110-1 and MSS110-2 Type Error (#170), Thanks @MrJer!
- Adds support for MSS630 device (#196), Thanks @rcoletti116!

## [Version 3.4.1](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.4.0....3.4.1) (2020-12-19)

### Changes

- Add option to change accessory `Firmware Revision` and `Serial Number`.
  - This fixes [#121](https://github.com/homebridge-plugins/homebridge-meross/issues/121) - `HomeKit showing as "Update Available"`.

## [Version 3.4.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.3.0....3.4.0) (2020-11-19)

### Changes

- Add preliminary support for MSG200.
  - Minor changes to support channels with the garage door opener, has been tested with the MSG100 and MSG200.
  - The MSG100 uses channel 0, for the single door, but the MSG200 uses channels 1, 2, and 3.
  - FWIW, setting channel 0 on the MSG200 to open or closed appears to control all doors.

## [Version 3.3.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.2.0....3.3.0) (2020-11-06)

### Changes

- Added basic support for MSL-100, MSL-120.

## [Version 3.2.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.1.0....3.2.0) (2020-10-15)

### Changes

- Added support for the MSS530H.
  - You set an ChannelID 1, 2 or 3.
    - Channel 1 is the Top Outlet.
    - Channel 2 the bottom left.
    - Channel 3 the bottom right.

## [Version 3.1.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v3.0.0....3.1.0) (2020-10-02)

### Changes

- Added brightness changing support to the MSS560 switch.

## [Version 3.0.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v2.3.1....3.0.0) (2020-09-17)

### Changes

- Converted Project to Typescript.

## [Version 2.3.1](https://github.com/homebridge-plugins/homebridge-meross/compare/v2.3.0...2.3.1) (2020-07-21)

### Changes

- Change garage door status check interval to 5s.

## [Version 2.3.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v2.2.0...2.3.0) (2020-06-22)

### Changes

- Get garage door status change notification by requesting status every 2s all the time. (#41) Thanks CocoaBob!

## [Version 2.2.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v2.1.0...2.2.0) (2020-06-16)

### Changes

- Add support for garage door opening time parameter. (#36) Thanks CocoaBob!

## [Version 2.1.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v2.0.0...2.1.0) (2020-04-13)

### Changes

- Changed Log to only display On & Off States.
- Compressed all other logging to debug.
  - To View This logging, turn on Homebridge Debug (-D) in Homebridge Settings of Config UI X.

## [Version 2.0.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.1.0...2.0.0) (2020-05-27)

### Changes

- added Support for MSG-100 (Garage Door Opener).

## IMPORTANT

### Homebridge v1.0.0

- Changed homebridge requirement to be v1.0.0 or higher.

## [Version 1.1.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.0.4...1.1.0) (2020-04-13)

### Changes

- Update config.schema.json with specific models that are supported.
- Changed requirements for specific models on what fields are needed.
- Added helpful wiki links to repo

# IMPORTANT

### Change to Config Needed!

- We have replaced the `hardware revision` with `model`.
- We also changed the `deviceUrl` to only require the device IP Address.
- You will have to change your config to match the new config.schema.json layout.

## [Version 1.0.4](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.0.3...1.0.4) (2020-04-13)

### Changes

- fix config.schema.json

## [Version 1.0.3](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.0.2...1.0.3) (2020-04-13)

### Changes

- fix config.schema.json
- update engine dependencies

## [Version 1.0.2](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.0.1...1.0.2) (2020-04-11)

### Changes

- remove devDependencies homebridge-config-ui-x and homebridge
- update engine dependencies

## [Version 1.0.1](https://github.com/homebridge-plugins/homebridge-meross/compare/v1.0.0...1.0.1) (2020-04-08)

### Changes

- Update devDependencies homebridge-config-ui-x and homebridge

## [Version 1.0.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v0.1.0...1.0.0) (2020-04-06)

### Changes

- Update Readme

## [Version 0.1.0](https://github.com/homebridge-plugins/homebridge-meross/compare/v0.0.8...0.1.0) (2020-03-21)

### Changes

- Bump request from 2.88.0 to 2.88.2 [#8](https://github.com/homebridge-plugins/homebridge-meross/pull/8)

## [Version 0.0.8](https://github.com/homebridge-plugins/homebridge-meross/compare/v0.0.7...0.0.8) (2020-01-30)

### Changes

- Fixed config.schema.json

## [Version 0.0.7](https://github.com/homebridge-plugins/homebridge-meross/compare/v0.0.6...0.0.7) (2020-01-30)

### Changes

- Update dependencies

## [Version 0.0.6](https://github.com/homebridge-plugins/homebridge-meross/tree/v0.0.6) (2020-01-30)

### Changes

- Allowing for multiple devices.
