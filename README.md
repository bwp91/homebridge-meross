<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/donavanbecker/homebridge-meross/master/meross/03.png" width="150px"></a>

# Homebridge Meross

<a href="https://www.npmjs.com/package/homebridge-meross"><img title="npm version" src="https://badgen.net/npm/v/homebridge-meross?icon=npm" ></a>
<a href="https://www.npmjs.com/package/homebridge-meross"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-meross?icon=npm" ></a>

<p>The <a href="https://www.meross.com">Meross</a> plugin for
  <a href="https://homebridge.io">Homebridge</a>.

  This Plugin allows you to control your Meross Devices from HomeKit.
</p>

</span>

## Installation
* Install [config-ui-x](https://github.com/oznu/homebridge-config-ui-x).
* Search for "Meross" on the Plugin Screen of [config-ui-x](https://github.com/oznu/homebridge-config-ui-x) .
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
