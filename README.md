<p align="center">
 <a href="https://github.com/bwp91/homebridge-meross"><img alt="Homebridge Verified" src="https://user-images.githubusercontent.com/43026681/127397024-8b15fc07-f31b-44bd-89e3-51d738d2609a.png" width="600px"></a>
</p>
<span align="center">

# homebridge-meross

Homebridge plugin to integrate Meross devices into HomeKit

[![npm](https://img.shields.io/npm/v/homebridge-meross/latest?label=latest)](https://www.npmjs.com/package/homebridge-meross)
[![npm](https://img.shields.io/npm/v/homebridge-meross/beta?label=beta)](https://github.com/bwp91/homebridge-meross/wiki/Beta-Version)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![hoobs-certified](https://badgen.net/badge/HOOBS/certified/yellow?label=hoobs)](https://plugins.hoobs.org/plugin/homebridge-meross)

[![npm](https://img.shields.io/npm/dt/homebridge-meross)](https://www.npmjs.com/package/homebridge-meross)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.com/channels/432663330281226270/742733745743855627)

</span>

### Plugin Information

- This plugin allows you to view and control your Meross devices within HomeKit. The plugin:
  - downloads a device list if your Meross credentials are supplied
  - attempts to control your devices locally, reverting to cloud control if necessary
  - listens for real-time device updates when controlled externally
  - supports configuring devices for local-only control without your Meross credentials
  - can ignore any HomeKit-native devices you have using the configuration

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v18` or `v20` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v1.6` - refer to link for more information and installation instructions.

### Setup

- [Installation](https://github.com/bwp91/homebridge-meross/wiki/Installation)
- [Configuration](https://github.com/bwp91/homebridge-meross/wiki/Configuration)
- [Beta Version](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions)
- [Node Version](https://github.com/bwp91/homebridge-meross/wiki/Node-Version)

### Features

- [Supported Devices](https://github.com/bwp91/homebridge-meross/wiki/Supported-Devices)
- [Cloud Control](https://github.com/bwp91/homebridge-meross/wiki/Cloud-Control)
- [Local Control](https://github.com/bwp91/homebridge-meross/wiki/Local-Control)

### Help/About

- [Common Errors](https://github.com/bwp91/homebridge-meross/wiki/Common-Errors)
- [Support Request](https://github.com/bwp91/homebridge-meross/issues/new/choose)
- [Changelog](https://github.com/bwp91/homebridge-meross/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- This is a fork of the work originally done by [@Robdel12](https://github.com/Robdel12) and [@dylanfrankcom](https://github.com/dylanfrankcom).
- To [@donavanbecker](https://github.com/donavanbecker) the previous maintainer of this plugin.
- To [@Apollon77](https://github.com/Apollon77) and [@colthreepv](https://github.com/colthreepv) for the [meross-cloud](https://github.com/Apollon77/meross-cloud) library (contained in this plugin).
- To the creator of the awesome plugin header logo: [Keryan Belahcene](https://www.instagram.com/keryan.me).
- To the creators/contributors of [Fakegato](https://github.com/simont77/fakegato-history): [@simont77](https://github.com/simont77) and [@NorthernMan54](https://github.com/NorthernMan54).
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with Meross and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
