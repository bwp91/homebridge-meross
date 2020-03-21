
#  Meross Plugin for Homebridge

[![npm](https://badgen.net/npm/v/homebridge-meross?icon=npm)](https://www.npmjs.com/package/homebridge-meross)
[![npm](https://badgen.net/npm/dt/homebridge-meross)](https://www.npmjs.com/package/homebridge-meross)
[![GitHub Workflow Status](https://img.shields.io/github/workflow/status/donavanbecker/homebridge-meross/Node)](https://github.com/donavanbecker/homebridge-meross/actions?query=workflow%3ANode)

If you would like to help out with this plugin you can reach out to me on [discord](https://discord.gg/bHjKNkN)

This is a plugin for Homebridge. This is a fork of the work originally done by [Robdel12](https://github.com/Robdel12) & [dylanfrankcom](https://github.com/dylanfrankcom).


## Installation
* For easy Install, Install [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x).
* From [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x) Search for "Meross" on the Plugin Screen.
* Click Install on Homebridge Meross.

## Auth & Config
If you're setting this plug up fresh, make sure you go through the
typical Meross app for initial setup.

You will also have to obtain some information that the Meross mobile
app uses in its HTTP request headers. The [Charles](https://www.charlesproxy.com)
proxy application can be used to sniff the network requests sent from the iOS app.
A detailed tutorial on how to set up Charles with your iOS device can be found
[here](https://www.raywenderlich.com/641-charles-proxy-tutorial-for-ios).

There are currently
[two](https://user-images.githubusercontent.com/11139929/57955871-0cca8480-78c5-11e9-8185-6efd358bd1b1.png)
hardware versions.
There are some differences in requests sent between hardware
[version 1](https://user-images.githubusercontent.com/11139929/57955231-50bc8a00-78c3-11e9-9989-1d390cc7ca42.png)
and
[version 2](https://user-images.githubusercontent.com/11139929/57955272-6b8efe80-78c3-11e9-9bc0-2a54a97d9ac9.png). Note the brown and black markings.
This is the information needed for your `config.json` file.
Also note there is no "channel" attribute for hardware version 1.
You may safely set that to 0 in your config.
