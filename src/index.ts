/* eslint-disable prefer-const */
/* eslint-disable no-useless-escape */
'use strict';
import { CharacteristicValue } from 'homebridge';
import request from 'request';
let Service, Characteristic;

// convert three r,g,b integers (each 0-255) to a single decimal integer (something between 0 and ~16m)
function colourToNumber(r, g, b) {
  return (r << 16) + (g << 8) + b;
}

// convert it back again (to a string)
function numberToColour(number) {
  const r = (number & 0xff0000) >> 16;
  const g = (number & 0x00ff00) >> 8;
  const b = number & 0x0000ff;
  return [r, g, b];
}

function HSLToRGB(h, s, l) {
  // Must be fractions of 1
  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (60 <= h && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (120 <= h && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (180 <= h && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (240 <= h && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (300 <= h && h < 360) {
    r = c;
    g = 0;
    b = x;
  }
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return [r, g, b];
}

function RGBToHSL(r, g, b) {
  // Make r, g, and b fractions of 1
  r /= 255;
  g /= 255;
  b /= 255;

  // Find greatest and smallest channel values
  let cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin,
    h = 0,
    s = 0,
    l = 0;

  // Calculate hue
  // No difference
  if (delta === 0) {
    h = 0;
  } else if (cmax === r) {  // Red is max
    h = ((g - b) / delta) % 6;
  } else if (cmax === g) {  // Green is max
    h = (b - r) / delta + 2;
  } else {  // Blue is max
    h = (r - g) / delta + 4;
  }

  h = Math.round(h * 60);

  // Make negative hues positive behind 360°
  if (h < 0) {
    h += 360;
  }

  // Calculate lightness
  l = (cmax + cmin) / 2;

  // Calculate saturation
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  // Multiply l and s by 100
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  //return "hsl(" + h + "," + s + "%," + l + "%)";
  return [h, s, l];
}

// Wrap request with a promise to make it awaitable
function doRequest(options) {
  return new Promise((resolve, reject) => {
    request(options, (error, res, body) => {
      if (!error && res.statusCode === 200) {
        resolve(body);
      } else {
        reject(error);
      }
    });
  });
}

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-meross', 'Meross', Meross);
};

class Meross {
  log: any;
  config: any;
  service: any;
  isOn: any;
  brightness: any;
  saturation: any;
  hue: any;
  temperature: any;
  currentState: any;
  lastSetTime!: number;
  checkStateInterval!: NodeJS.Timeout;
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

    /* To be used later
     switch (config.model) {
      case "MSS110-1":
      case "MSS110-2":
      case "MSS210":
      case "MSS310":
      case "MSS420F":
      case "MSS425":
      case "MSS425E":
      case "MSS425F":
      case "MSS620":
        this.service = new Service.Outlet(this.config.name);
        break;
      case "MSS510":
      case "MSS510M":
      case 'MSS530H':
      case "MSS550":
      case "MSS560":
      case "MSS570":
      case "MSS5X0":
        this.service = new Service.Switch(this.config.name);
        break;
      case "MSG100":
      case "MSG200":
        this.service = new Service.GarageDoorOpener(this.config.name);
        break;
      case "MSL100":
      case "MSL120":
      case "MSL420":
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case "MTS100":
      case "MTS100H":
        this.service = new Service.Thermostat(this.config.name);
        break;
      case "MS100":
      case "MS100H":
        this.service = new Service.TemperatureSensor(this.config.name);
        break;
      case "MSXH0":
        this.service = new Service.HumidifierDehumidifier(this.config.name);
        break;
      case "MRS110":
        this.service = new Service.WindowCovering(this.config.name);
        break;
      default:
        this.service = new Service.Outlet(this.config.name);
    }
     */
    switch (config.model) {
      case 'MSS110-1':
      case 'MSS110-2':
        this.service = new Service.Outlet(this.config.name);
        break;
      case 'MSL-100':
      case 'MSL-420':
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case 'MSL-120':
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case 'MSL-320':
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case 'MSS210':
      case 'MSS310':
      case 'MSS420F':
      case 'MSS425':
      case 'MSS425E':
      case 'MSS425F':
      case 'MSS630':
      case 'MSS620':
        this.service = new Service.Outlet(this.config.name);
        break;
      case 'MSS510':
      case 'MSS510M':
      case 'MSS530H':
      case 'MSS550':
      case 'MSS570':
      case 'MSS5X0':
        this.service = new Service.Switch(this.config.name);
        break;
      case 'MSS560':
        this.service = new Service.Lightbulb(this.config.name);
        break;
      case 'MSG100':
      case 'MSG200':
        this.service = new Service.GarageDoorOpener(this.config.name);
        this.startUpdatingDoorState();
        break;
      default:
        this.service = new Service.Outlet(this.config.name);
    }
  }

  getServices() {
    /*
     * The getServices function is called by Homebridge and should return an array of Services this accessory is exposing.
     * It is also where we bootstrap the plugin to tell Homebridge which function to use for which action.
     */

    /* Create a new information service. This just tells HomeKit about our accessory. */
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Meross')
      .setCharacteristic(Characteristic.Model, this.config.model)
      .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber || this.config.deviceUrl)
      .setCharacteristic(Characteristic.FirmwareRevision, this.config.firmwareRevision || this.config.deviceUrl);

    /*
     * For each of the service characteristics we need to register setters and getter functions
     * 'get' is called when HomeKit wants to retrieve the current state of the characteristic
     * 'set' is called when HomeKit wants to update the value of the characteristic
     */
    switch (this.config.model) {
      case 'MSG100':
      case 'MSG200':
        this.service
          .getCharacteristic(Characteristic.CurrentDoorState)
          .onGet(this.getDoorStateHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.TargetDoorState)
          .onGet(this.getDoorStateHandler.bind(this))
          .onSet(this.setDoorStateHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.ObstructionDetected)
          .onGet(this.getObstructionDetectedHandler.bind(this));
        break;
      case 'MSL-100':
      case 'MSL-420':
        this.service
          .getCharacteristic(Characteristic.Hue)
          .onGet(this.getHueCharacteristicHandler.bind(this))
          .onSet(this.setHueCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.ColorTemperature)
          .onGet(this.getColorTemperatureCharacteristicHandler.bind(this))
          .onSet(this.setColorTemperatureCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Saturation)
          .onGet(this.getSaturationCharacteristicHandler.bind(this))
          .onSet(this.setSaturationCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Brightness)
          .onGet(this.getBrightnessCharacteristicHandler.bind(this))
          .onSet(this.setBrightnessCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.On)
          .onGet(this.getOnCharacteristicHandler.bind(this))
          .onSet(this.setOnCharacteristicHandler.bind(this));
        break;
      case 'MSL-120':
        this.service
          .getCharacteristic(Characteristic.Hue)
          .onGet(this.getHueCharacteristicHandler.bind(this))
          .onSet(this.setHueCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.ColorTemperature)
          .onGet(this.getColorTemperatureCharacteristicHandler.bind(this))
          .onSet(this.setColorTemperatureCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Saturation)
          .onGet(this.getSaturationCharacteristicHandler.bind(this))
          .onSet(this.setSaturationCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Brightness)
          .onGet(this.getBrightnessCharacteristicHandler.bind(this))
          .onSet(this.setBrightnessCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.On)
          .onGet(this.getOnCharacteristicHandler.bind(this))
          .onSet(this.setOnCharacteristicHandler.bind(this));
        break;
      case 'MSL-320':
        this.service
          .getCharacteristic(Characteristic.Hue)
          .onGet(this.getHueCharacteristicHandler.bind(this))
          .onSet(this.setHueCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.ColorTemperature)
          .onGet(this.getColorTemperatureCharacteristicHandler.bind(this))
          .onSet(this.setColorTemperatureCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Saturation)
          .onGet(this.getSaturationCharacteristicHandler.bind(this))
          .onSet(this.setSaturationCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.Brightness)
          .onGet(this.getBrightnessCharacteristicHandler.bind(this))
          .onSet(this.setBrightnessCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.On)
          .onGet(this.getOnCharacteristicHandler.bind(this))
          .onSet(this.setOnCharacteristicHandler.bind(this));
        break;
      case 'MSS560':
        this.service
          .getCharacteristic(Characteristic.Brightness)
          .onGet(this.getBrightnessCharacteristicHandler.bind(this))
          .onSet(this.setBrightnessCharacteristicHandler.bind(this));
        this.service
          .getCharacteristic(Characteristic.On)
          .onGet(this.getOnCharacteristicHandler.bind(this))
          .onSet(this.setOnCharacteristicHandler.bind(this));
        break;
      default:
        this.service
          .getCharacteristic(Characteristic.On)
          .onGet(this.getOnCharacteristicHandler.bind(this))
          .onSet(this.setOnCharacteristicHandler.bind(this));
    }

    /* Return both the main service (this.service) and the informationService */
    return [informationService, this.service];
  }

  public async setOnCharacteristicHandler(value: CharacteristicValue) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setOnCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    /*
     * Differentiate requests based on device model.
     */

    switch (this.config.model) {
      case 'MSS110-1':
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                toggle: {
                  onoff: value ? 1 : 0,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Toggle',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
        break;
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                togglex: {
                  onoff: value ? 1 : 0,
                  channel: `${this.config.channel}`,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.ToggleX',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }

    if (response) {
      this.isOn = value;
      this.log.debug('Set succeeded:', response);
      this.log(`${this.config.model} turned`, value ? 'On' : 'Off');
    } else {
      this.isOn = false;
      this.log('Set failed:', this.isOn);
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('setOnCharacteristicHandler:', value);
  }

  public async getOnCharacteristicHandler() {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //RGB led lightstrips use a different endpoint for retrieving current on / off status
    let namespace = 'Appliance.System.All';
    if (this.config.model === 'MSL-320') {
      namespace = 'Appliance.System.Online';
    }

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getOnCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: namespace,
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }

    /*
     * Differentiate response based on device model.
     */

    switch (this.config.model) {
      case 'MSS110-1':
        if (response) {
          const onOff = response.payload.all.control.toggle.onoff;

          this.log('Retrieved status successfully: ', onOff);
          this.isOn = onOff;
        } else {
          this.log('Retrieved status unsuccessfully.');
          this.isOn = false;
        }
        break;
      default:
        if (response) {
          if (response?.payload?.all?.digest?.togglex) {
            let onOff = response.payload.all.digest.togglex[`${this.config.channel}`].onoff;
            this.log.debug('Retrieved status successfully: ', onOff);
            this.isOn = onOff? true : false; // the received value was 1, not a boolean typed value.
          }
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
          this.isOn = false;
        }
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('getOnCharacteristicHandler:', this.isOn);
    return this.isOn;
  }

  public async setBrightnessCharacteristicHandler(value: CharacteristicValue) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setBrightnessCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    let payload;
    if (this.config.model === 'MSL-100' ||
      this.config.model === 'MSL-120' ||
      this.config.model === 'MSL-320' ||
      this.config.model === 'MSL-420') {
      payload = {
        light: {
          luminance: value,
          capacity: 4,
        },
      };
    } else {
      payload = {
        light: {
          luminance: value,
        },
      };
    }

    /*
     * Differentiate requests based on device model.
     */

    switch (this.config.model) {
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: payload,
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Light',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }

    if (response) {
      this.brightness = value;
      this.log.debug('Set succeeded:', response);
      this.log(`${this.config.model} set brightness to`, value);
    } else {
      this.brightness = this.isOn ? 100 : 0;
      this.log('Set failed:', this.brightness);
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('setBrightnessCharacteristicHandler:', value);
  }

  public async getBrightnessCharacteristicHandler() {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //RGB led lightstrips use a different endpoint for retrieving current on / off status
    let namespace = 'Appliance.System.All';
    if (this.config.model === 'MSL-320') {
      namespace = 'Appliance.System.Online';
    }

    //this.log(this.config, this.config.deviceUrl);
    let response;

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getBrightnessCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: namespace,
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    /*
     * Differentiate response based on device model.
     */

    switch (this.config.model) {
      default:
        if (response?.payload?.all?.digest?.light?.luminance) {
          const luminance = response.payload.all.digest.light.luminance;
          this.log.debug('Retrieved status successfully: ', luminance);
          this.brightness = luminance;
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
          this.brightness = this.isOn ? 100 : 0;
        }
    }

    /* Log to the console the value whenever this function is called */
    this.log.debug('getBrightnessCharacteristicHandler:', this.brightness);
  }

  public async setColorTemperatureCharacteristicHandler(value: CharacteristicValue) {
    let response;
    // Range on HomeKit is 140 - 500. 500 being yellow, 140 being white.
    // Range on Meross is 1-100. 1 being yellow, 100 being white.
    let mired = value;
    let mr_temp = Number(mired) - 140;
    mr_temp = 360 - mr_temp;
    mr_temp = mr_temp / 360;
    mr_temp = Math.round(mr_temp * 100);
    mr_temp = mr_temp === 0 ? 1 : mr_temp;

    this.log.debug(
      `calling setColorTemperatureCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    /*
     * Differentiate requests based on device model.
     */
    switch (this.config.model) {
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                light: {
                  temperature: mr_temp,
                  capacity: 2,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Light',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }
    if (response) {
      this.temperature = mr_temp;
      this.log.debug('Set succeeded:', response);
      this.log(
        `${this.config.model} set ColorTemperature to`,
        this.temperature,
      );
    }
    /* Log to the console the value whenever this function is called */
    this.log.debug(
      'setColorTemperatureCharacteristicHandler:',
      this.temperature,
    );
  }

  public async getColorTemperatureCharacteristicHandler() {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //RGB led lightstrips use a different endpoint for retrieving current on / off status
    let namespace = 'Appliance.System.All';
    if (this.config.model === 'MSL-320') {
      namespace = 'Appliance.System.Online';
    }

    let response;
    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getColorTemperatureCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: namespace,
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    /*
     * Differentiate response based on device model.
     */
    switch (this.config.model) {
      default:
        if (response?.payload?.all?.digest?.light?.temperature) {
          let tmp_temperature = response.payload.all.digest.light.temperature;
          let mr_temp = (tmp_temperature / 100) * 360;
          mr_temp = 360 - mr_temp;
          mr_temp = mr_temp + 140;
          mr_temp = Math.round(mr_temp);
          this.temperature = mr_temp;
          this.log.debug(
            'Retrieved temp status successfully: ',
            this.temperature,
          );
        }
    }
    /* Log to the console the value whenever this function is called */
    this.log.debug(
      'getColorTemperatureCharacteristicHandler:',
      this.temperature,
    );
  }

  public setHueCharacteristicHandler(value: CharacteristicValue) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */
    //this.log(this.config, this.config.deviceUrl);
    this.hue = value;
    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setHueCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    this.log.debug('Hue succeeded:', this.hue);
    this.log.debug('Sat succeeded:', this.saturation);
  }

  public async getHueCharacteristicHandler() {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //RGB led lightstrips use a different endpoint for retrieving current on / off status
    let namespace = 'Appliance.System.All';
    if (this.config.model === 'MSL-320') {
      namespace = 'Appliance.System.Online';
    }

    //this.log(this.config, this.config.deviceUrl);
    let response;
    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling gethueCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: namespace,
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    /*
     * Differentiate response based on device model.
     */
    switch (this.config.model) {
      default:
        if (response?.payload?.all?.digest?.light) {
          this.log.debug(
            'Retrieved status successfully: ',
            response.payload.all.digest.light,
          );

          let light_rgb = response.payload.all.digest.light.rgb;
          let rgb = numberToColour(light_rgb);
          let hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
          const hue = hsl[0];
          this.log.debug('Retrieved hue status successfully: ', hue);
          this.hue = hue;
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
        }
    }
    /* Log to the console the value whenever this function is called */
    this.log.debug('gethueCharacteristicHandler:', this.hue);
  }

  public async setSaturationCharacteristicHandler(value: CharacteristicValue) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */
    //this.log(this.config, this.config.deviceUrl);
    let response;
    this.saturation = value;
    let rgb = HSLToRGB(this.hue, this.saturation, 50);
    let rgb_d = colourToNumber(rgb[0], rgb[1], rgb[2]);

    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling setsaturationCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    /*
     * Differentiate requests based on device model.
     */
    switch (this.config.model) {
      default:
        try {
          response = await doRequest({
            json: true,
            method: 'POST',
            strictSSL: false,
            url: `http://${this.config.deviceUrl}/config`,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              payload: {
                light: {
                  rgb: rgb_d,
                  capacity: 1,
                  luminance: this.brightness,
                },
              },
              header: {
                messageId: `${this.config.messageId}`,
                method: 'SET',
                from: `http://${this.config.deviceUrl}\/config`,
                namespace: 'Appliance.Control.Light',
                timestamp: this.config.timestamp,
                sign: `${this.config.sign}`,
                payloadVersion: 1,
              },
            },
          });
        } catch (e) {
          this.log(
            `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
            e,
          );
        }
    }
    if (response) {
      this.saturation = value;
      this.log.debug('Set succeeded:', response);
      this.log(`${this.config.model} set saturation to`, value);
    } else {
      this.log('Set failed:', this.saturation);
    }
    /* Log to the console the value whenever this function is called */
    this.log.debug('setsaturationCharacteristicHandler:', value);
  }

  public async getSaturationCharacteristicHandler() {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */

    //RGB led lightstrips use a different endpoint for retrieving current on / off status
    let namespace = 'Appliance.System.All';
    if (this.config.model === 'MSL-320') {
      namespace = 'Appliance.System.Online';
    }

    //this.log(this.config, this.config.deviceUrl);
    let response;
    /* Log to the console whenever this function is called */
    this.log.debug(
      `calling getsaturationCharacteristicHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: namespace,
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    /*
     * Differentiate response based on device model.
     */
    switch (this.config.model) {
      default:
        if (response?.payload?.all?.digest?.light) {
          this.brightness = response.payload.all.digest.light.luminance;
          this.temperature = response.payload.all.digest.light.temperature;

          let light_rgb = response.payload.all.digest.light.rgb;
          let rgb = numberToColour(light_rgb);
          let hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
          const saturation = hsl[1];
          this.log.debug(
            'Retrieved saturation status successfully: ',
            saturation,
          );
          this.log.debug(
            'Retrieved saturation/hue status successfully: ',
            this.hue,
          );
          this.saturation = saturation;
        } else {
          this.log.debug('Retrieved status unsuccessfully.');
          this.saturation = this.isOn ? 100 : 0;
        }
    }
    /* Log to the console the value whenever this function is called */
    this.log.debug('getsaturationCharacteristicHandler:', this.saturation);
  }

  public getDoorStateHandler(callback) {
    /*
     * this is called when HomeKit wants to retrieve the current state of the characteristic as defined in our getServices() function
     * it's called each time you open the Home app or when you open control center
     */
    this.log.debug(
      `getDoorStateHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    this.getDoorState()
      .then((state) => callback(null, state))
      .catch((e) => this.log(`${e}`));
  }

  public getObstructionDetectedHandler(callback) {
    this.log.debug(
      `getObstructionDetectedHandler for ${this.config.model} at ${this.config.deviceUrl}...`,
    );
    callback(null, Characteristic.ObstructionDetected.NO);
  }

  public setDoorStateHandler(value: CharacteristicValue) {
    /* this is called when HomeKit wants to update the value of the characteristic as defined in our getServices() function */
    /* deviceUrl only requires ip address */

    this.log.debug(
      `setDoorStateHandler ${value} for ${this.config.model} at ${this.config.deviceUrl}...`,
    );

    this.getDoorState()
      .then((state) => {
        if (value === Characteristic.TargetDoorState.CLOSED) {
          if (state === Characteristic.CurrentDoorState.OPEN) {
            this.log('Target CLOSED, Current OPEN, close the door');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            this.setDoorState(false);
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else if (state === Characteristic.CurrentDoorState.CLOSED) {
            this.log('Target CLOSED, Current CLOSED, no change');
            this.currentState = Characteristic.CurrentDoorState.CLOSED;
          } else if (state === Characteristic.CurrentDoorState.OPENING) {
            this.log(
              'Target CLOSED, Current OPENING, stop the door (then it stays in open state)',
            );
            this.currentState = Characteristic.CurrentDoorState.OPEN;
            this.setDoorState(false);
            this.service.setCharacteristic(
              Characteristic.TargetDoorState,
              Characteristic.TargetDoorState.OPEN,
            );
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPEN,
            );
          } else if (state === Characteristic.CurrentDoorState.CLOSING) {
            this.log('Target CLOSED, Current CLOSING, no change');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
          } else if (state === Characteristic.CurrentDoorState.STOPPED) {
            this.log('Target CLOSED, Current STOPPED, close the door');
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            this.setDoorState(false);
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else {
            this.log('Target CLOSED, Current UNKOWN, no change');
          }
        } else if (value === Characteristic.TargetDoorState.OPEN) {
          if (state === Characteristic.CurrentDoorState.OPEN) {
            this.log('Target OPEN, Current OPEN, no change');
            this.currentState = Characteristic.CurrentDoorState.OPEN;
          } else if (state === Characteristic.CurrentDoorState.CLOSED) {
            this.log('Target OPEN, Current CLOSED, open the door');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
            this.setDoorState(true);
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPENING,
            );
          } else if (state === Characteristic.CurrentDoorState.OPENING) {
            this.log('Target OPEN, Current OPENING, no change');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
          } else if (state === Characteristic.CurrentDoorState.CLOSING) {
            this.log(
              'Target OPEN, Current CLOSING, Meross does not accept OPEN request while closing',
              ' since the sensor is already open, no change.',
            );
            this.currentState = Characteristic.CurrentDoorState.CLOSING;
            this.service.setCharacteristic(
              Characteristic.TargetDoorState,
              Characteristic.TargetDoorState.CLOSING,
            );
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.CLOSING,
            );
          } else if (state === Characteristic.CurrentDoorState.STOPPED) {
            this.log('Target OPEN, Current STOPPED, open the door');
            this.currentState = Characteristic.CurrentDoorState.OPENING;
            this.setDoorState(true);
            this.service.setCharacteristic(
              Characteristic.CurrentDoorState,
              Characteristic.CurrentDoorState.OPENING,
            );
          } else {
            this.log('Target OPEN, Current UNKOWN, no change');
          }
        }
      })
      .catch((e) => this.log(`${e}`));
  }

  async setDoorState(open) {
    this.lastSetTime = Math.floor(Date.now() / 1000);
    let response;
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {
            state: {
              channel: `${this.config.channel}`,
              open: open ? 1 : 0,
              uuid: `${this.config.deviceUrl}`,
            },
          },
          header: {
            messageId: `${this.config.messageId}`,
            method: 'SET',
            from: `http://${this.config.deviceUrl}\/config`,
            namespace: 'Appliance.GarageDoor.State',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
            triggerSrc: 'iOS',
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
    }
    return response;
  }

  async getDoorState() {
    let response;
    try {
      response = await doRequest({
        json: true,
        method: 'POST',
        strictSSL: false,
        url: `http://${this.config.deviceUrl}/config`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          payload: {},
          header: {
            messageId: `${this.config.messageId}`,
            method: 'GET',
            from: `http://${this.config.deviceUrl}/config`,
            namespace: 'Appliance.System.All',
            timestamp: this.config.timestamp,
            sign: `${this.config.sign}`,
            payloadVersion: 1,
          },
        },
      });
    } catch (e) {
      this.log(
        `Failed to POST to the Meross Device ${this.config.model} at ${this.config.deviceUrl}:`,
        e,
      );
      throw e;
    }

    if (response?.payload?.all?.digest?.garageDoor) {
      // Open means magnetic sensor not detected, doesn't really mean the door is open
      let isOpen = (this.currentState === Characteristic.CurrentDoorState.OPEN);
      for (let i = 0; i < response.payload.all.digest.garageDoor.length; i++) {
        if (response.payload.all.digest.garageDoor[i].channel === this.config.channel) {
          isOpen = response.payload.all.digest.garageDoor[i].open;
        }
      }
      if (isOpen) {
        const currentTime = Math.floor(Date.now() / 1000);
        const elapsedTime = currentTime - this.lastSetTime;
        if (this.currentState === Characteristic.CurrentDoorState.OPENING) {
          this.currentState =
            elapsedTime < this.config.garageDoorOpeningTime
              ? Characteristic.CurrentDoorState.OPENING
              : Characteristic.CurrentDoorState.OPEN;
        } else if (
          this.currentState === Characteristic.CurrentDoorState.CLOSING
        ) {
          this.currentState =
            elapsedTime < this.config.garageDoorOpeningTime
              ? Characteristic.CurrentDoorState.CLOSING
              : Characteristic.CurrentDoorState.OPEN;
        } else {
          this.currentState = Characteristic.CurrentDoorState.OPEN;
        }
      } else {
        this.currentState = Characteristic.CurrentDoorState.CLOSED;
      }
    }

    switch (this.currentState) {
      case Characteristic.CurrentDoorState.OPEN:
        this.log.debug('Current state OPEN');
        break;
      case Characteristic.CurrentDoorState.CLOSED:
        this.log.debug('Current state CLOSED');
        break;
      case Characteristic.CurrentDoorState.OPENING:
        this.log.debug('Current state OPENING');
        break;
      case Characteristic.CurrentDoorState.CLOSING:
        this.log.debug('Current state CLOSING');
        break;
      case Characteristic.CurrentDoorState.STOPPED:
        this.log.debug('Current state STOPPED');
        break;
      default:
        this.log.debug('Current state UNKNOWN');
    }

    return this.currentState;
  }

  startUpdatingDoorState() {
    this.stopUpdatingDoorState();
    // Update state repeatedly
    this.checkStateInterval = setInterval(() => {
      this.getDoorState()
        .then((state) =>
          this.service.setCharacteristic(Characteristic.CurrentDoorState, state),
        )
        .catch((e) => this.log(`${e}`));
    }, 5000);
  }

  stopUpdatingDoorState() {
    clearInterval(this.checkStateInterval);
    this.checkStateInterval;
  }
}
