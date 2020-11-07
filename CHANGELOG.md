# Change Log

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## [Version 3.3.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v3.2.0....3.3.0) (2020-11-06)

#### Changes

- Added basic support for MSL-100, MSL-120.

## [Version 3.2.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v3.1.0....3.2.0) (2020-10-15)

#### Changes

- Added support for the MSS530H.
  - You set an ChannelID 1, 2 or 3.
    - Channel 1 is the Top Outlet.
    - Channel 2 the bottom left.
    - Channel 3 the bottom right.

## [Version 3.1.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v3.0.0....3.1.0) (2020-10-02)

#### Changes

- Added brightness changing support to the MSS560 switch.

## [Version 3.0.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v2.3.1....3.0.0) (2020-09-17)

#### Changes

- Converted Project to Typescript.

## [Version 2.3.1](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v2.3.0...2.3.1) (2020-07-21)

#### Changes

- Change garage door status check interval to 5s.

## [Version 2.3.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v2.2.0...2.3.0) (2020-06-22)

#### Changes

- Get garage door status change notification by requesting status every 2s all the time. (#41) Thanks CocoaBob!

## [Version 2.2.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v2.1.0...2.2.0) (2020-06-16)

#### Changes

- Add support for garage door opening time parameter. (#36) Thanks CocoaBob!

## [Version 2.1.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v2.0.0...2.1.0) (2020-04-13)

#### Changes

- Changed Log to only display On & Off States.
- Compressed all other logging to debug.
  - To View This logging, turn on Homebridge Debug (-D) in Homebridge Settings of Config UI X.

## [Version 2.0.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.1.0...2.0.0) (2020-05-27)

#### Changes

- added Support for MSG-100 (Garage Door Opener).

## IMPORTANT

#### Homebridge v1.0.0

- Changed homebridge requirement to be v1.0.0 or higher.

## [Version 1.1.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.0.4...1.1.0) (2020-04-13)

#### Changes

- Update config.schema.json with specific models that are supported.
- Changed requirements for specific models on what fields are needed.
- Added helpful wiki links to repo

# IMPORTANT

#### Change to Config Needed!

- We have replaced the `hardware revision` with `model`.
- We also changed the `deviceUrl` to only require the device IP Address.
- You will have to change your config to match the new config.schema.json layout.

## [Version 1.0.4](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.0.3...1.0.4) (2020-04-13)

#### Changes

- fix config.schema.json

## [Version 1.0.3](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.0.2...1.0.3) (2020-04-13)

#### Changes

- fix config.schema.json
- update engine dependencies

## [Version 1.0.2](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.0.1...1.0.2) (2020-04-11)

#### Changes

- remove devDependencies homebridge-config-ui-x and homebridge
- update engine dependencies

## [Version 1.0.1](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v1.0.0...1.0.1) (2020-04-08)

#### Changes

- Update devDependencies homebridge-config-ui-x and homebridge

## [Version 1.0.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v0.1.0...1.0.0) (2020-04-06)

#### Changes

- Update Readme

## [Version 0.1.0](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v0.0.8...0.1.0) (2020-03-21)

#### Changes

- Bump request from 2.88.0 to 2.88.2 [#8](https://github.com/donavanbecker/homebridge-meross/pull/8)

## [Version 0.0.8](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v0.0.7...0.0.8) (2020-01-30)

#### Changes

- Fixed config.schema.json

## [Version 0.0.7](https://github.com/donavanbecker/homebridge-honeywell-home/compare/v0.0.6...0.0.7) (2020-01-30)

#### Changes

- Update dependencies

## [Version 0.0.6](https://github.com/donavanbecker/homebridge-meross/tree/v0.0.6) (2020-01-30)

#### Changes

- Allowing for multiple devices.
