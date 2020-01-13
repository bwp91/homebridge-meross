"use strict";

const request = require("request");
let Service, Characteristic;

// Wrap request with a promise to make it awaitable
function doRequest(options) {
  return new Promise(function(resolve, reject) {
    request(options, function(error, res, body) {
      if (!error && res.statusCode == 200) {
        resolve(body);
      } else {
        reject(error);
      }
    });
  });
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-meross-plug", "Meross", MerossPlug);
};

class MerossPlug {
  constructor(log, config) {
    /*
     * The constructor function is called when the plugin is registered.
     * log is a function that can be used to log output to the homebridge console
     * config is an object that contains the config for this plugin that was defined the homebridge config.json
     */

    /* assign both log and config to properties on 'this' class so we can use them in other methods */
    this.log = log;
    this.config = config;

    /*
     * A HomeKit accessory can have many "services". This will create our base service,
     * Service types are defined in this code: https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js
     * Search for "* Service" to tab through each available service type.
     * Take note of the available "Required" and "Optional" Characteristics for the service you are creating
     */
    this.service = new Service.Switch(this.config.name);
  }

  getServices() {
    /*
     * The getServices function is called by Homebridge and should return an array of Services this accessory is exposing.
     * It is also where we bootstrap the plugin to tell Homebridge which function to use for which action.
     */

    /* Create a new information service. This just tells HomeKit about our accessory. */
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, "meross")
      .setCharacteristic(Characteristic.Model, "MSS110")
      .setCharacteristic(Characteristic.SerialNumber, "lol");

    /*
     * For each of the service characteristics we need to register setters and getter functions
     * 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     * 'set' is called when HomeKit wants to update the value of the characteristic
     */
    this.service
      .getCharacteristic(Characteristic.On)
      .on("get", this.getOnCharacteristicHandler.bind(this))
      .on("set", this.setOnCharacteristicHandler.bind(this));

    /* Return both the main service (this.service) and the informationService */
    return [informationService, this.service];
  }

  async setOnCharacteristicHandler(value, callback) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    this.log(this.config, `${this.config.deviceUrl}/config`);
    let response;

    /*
     * This assumes future versions of MSS110 plugs will adopt the 2.x.x + payload. Easy enough to adapt if neccessary.
     * case 1 - Hardware version 1.x.x
     * default - Hardware version 2.x.x +
     */

    switch (this.config.hardwareVersion) {
      case 1:
        try {
          response = await doRequest({
            json: true,
            method: "POST",
            strictSSL: false,
            url: `${this.config.deviceUrl}/config`,
            headers: {
              "Content-Type": "application/json"
            },
            body: {
              payload: {
                toggle: {
                  onoff: value ? 1 : 0
                }
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: "SET",
                from: `${this.config.deviceUrl}\/config`,
                namespace: "Appliance.Control.Toggle",
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1
              }
            }
          });
        } catch (e) {
          this.log("Failed to POST to the Meross Plug: ", e);
        }
        break;
      default:
        try {
          response = await doRequest({
            json: true,
            method: "POST",
            strictSSL: false,
            url: `${this.config.deviceUrl}/config`,
            headers: {
              "Content-Type": "application/json"
            },
            body: {
              payload: {
                togglex: {
                  onoff: value ? 1 : 0,
                  channel: `${this.config.channel}`
                }
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: "SET",
                from: `${this.config.deviceUrl}\/config`,
                namespace: "Appliance.Control.ToggleX",
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1
              }
            }
          });
        } catch (e) {
          this.log("Failed to POST to the Meross Plug:", e);
        }
    }

    if (response) {
      this.isOn = value;
      this.log("Set succeeded:", response);
    } else {
      this.isOn = false;
      this.log("Set failed:", this.isOn);
    }

    /* Log to the console the value whenever this function is called */
    this.log("calling setOnCharacteristicHandler:", value);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     */
    callback(null, this.isOn);
  }

  async getOnCharacteristicHandler(callback) {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    let response;

    try {
      response = await doRequest({
        json: true,
        method: "POST",
        strictSSL: false,
        url: `${this.config.deviceUrl}/config`,
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: "GET",
            from: `${this.config.deviceUrl}/config`,
            namespace: "Appliance.System.All",
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1
          }
        }
      });
    } catch (e) {
      this.log("Failed to POST to the Meross Plug:", e);
    }

    switch (this.config.hardwareVersion) {
      case 1:
        if (response) {
          let onOff = response.payload.all.control.toggle.onoff;

          this.log("Retrieved status successfully: ", onOff);
          this.isOn = onOff;
        } else {
          this.log("Retrieved status unsuccessfully.");
          this.isOn = false;
        }
        break;

      default:
        if (response) {
          let onOff =
            response.payload.all.digest.togglex[`${this.config.channel}`].onoff;

          this.log("Retrieved status successfully: ", onOff);
          this.isOn = onOff;
        } else {
          this.log("Retrieved status unsuccessfully.");
          this.isOn = false;
        }
    }

    this.log("calling getOnCharacteristicHandler:", this.isOn);
    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     * The second argument in the function should be the current value of the characteristic
     * This is just an example so we will return the value from `this.isOn` which is where we stored the value in the set handler
     */
    callback(null, this.isOn);
  }
}
