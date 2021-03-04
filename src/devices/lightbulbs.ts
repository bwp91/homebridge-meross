import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { Meross } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig, data, numberToColour, RGBToHSL, colourToNumber, HSLToRGB, PLATFORM_NAME, payload, light, header } from '../settings';

export class lightBulb {
  private service: Service;

  On!: CharacteristicValue;
  Saturation?: CharacteristicValue;
  Brightness!: CharacteristicValue;
  ColorTemperature?: CharacteristicValue;
  Hue?: CharacteristicValue;

  UpdateInProgress!: boolean;
  doUpdate!: Subject<unknown>;
  deviceStatus: any;
  Namespace!: header['namespace'];
  Payload!: payload;
  Data!: data;
  Request!: string;
  rgb_d: light['rgb'];
  mr_temp!: light['temperature'];

  constructor(
    private readonly platform: Meross,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
  ) {
    // default placeholders
    this.On = false;

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.doUpdate = new Subject();
    this.UpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, this.device.model!)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.serialNumber || device.deviceUrl!)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, device.firmwareRevision || device.deviceUrl!);

    // get the WindowCovering service if it exists, otherwise create a new WindowCovering service
    // you can create multiple services for each accessory
    (this.service =
      accessory.getService(this.platform.Service.Lightbulb) ||
      accessory.addService(this.platform.Service.Lightbulb)), device.name!;

    // Set Name Characteristic
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name!);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.BrightnessSet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.OnSet.bind(this));

    switch (device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
        this.service
          .getCharacteristic(this.platform.Characteristic.Hue)
          .onSet(this.HueSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.ColorTemperature)
          .onSet(this.ColorTemperatureSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.Saturation)
          .onSet(this.SaturationSet.bind(this));
        break;
      case 'MSS560':
      default:
    }

    // Update Homekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.refreshRate! * 1000)
      .pipe(skipWhile(() => this.UpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });


    // Watch for Plug change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doUpdate
      .pipe(
        tap(() => {
          this.UpdateInProgress = true;
        }),
        debounceTime(this.platform.config.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          switch (device.model) {
            case 'MSL-100':
            case 'MSL-420':
            case 'MSL-120':
            case 'MSL-320':
              await this.pushOnChanges();
              await this.pushBrightnessChanges();
              await this.pushSaturationChanges();
              await this.pushColorTemperatureChanges();
              break;
            case 'MSS560':
            default:
              await this.pushOnChanges();
              await this.pushBrightnessChanges();
          }
        } catch (e) {
          this.platform.log.error(
            'Failed to POST to the Meross Device %s at %s:',
            this.device.model,
            this.device.deviceUrl,
            JSON.stringify(e.message),
          );
          this.platform.log.debug('Plug %s -', accessory.displayName, JSON.stringify(e));
          this.apiError(e);
        }
        this.UpdateInProgress = false;
      });
  }

  parseStatus() {
    switch (this.device.model) {
      case 'MSS110-1':
        if (this.deviceStatus) {
          const onOff = this.deviceStatus.payload.all.control.toggle.onoff;

          this.platform.log.debug('Retrieved status successfully: ', onOff);
          this.On = onOff;
        } else {
          this.platform.log.debug('Retrieved status unsuccessfully.');
          this.On = false;
        }
        break;
      default:
        if (this.deviceStatus) {
          if (this.deviceStatus?.payload?.all?.digest?.togglex) {
            const onOff = this.deviceStatus.payload.all.digest.togglex[`${this.device.channel}`].onoff;
            this.platform.log.debug('Retrieved status successfully: ', onOff);
            this.On = onOff;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.On = false;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.luminance) {
            const luminance = this.deviceStatus.payload.all.digest.light.luminance;
            this.platform.log.debug('Retrieved status successfully: ', luminance);
            this.Brightness = luminance;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Brightness = this.On ? 100 : 0;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.temperature) {
            const tmp_temperature = this.deviceStatus.payload.all.digest.light.temperature;
            let mr_temp = (tmp_temperature / 100) * 360;
            mr_temp = 360 - mr_temp;
            mr_temp = mr_temp + 140;
            mr_temp = Math.round(mr_temp);
            this.ColorTemperature = mr_temp;
            this.platform.log.debug(
              'Retrieved temp status successfully: ',
              this.ColorTemperature,
            );
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.platform.log.debug(
              'Retrieved status successfully: ',
              this.deviceStatus.response.payload.all.digest.light,
            );

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const hue = hsl[0];
            this.platform.log.debug('Retrieved hue status successfully: ', hue);
            this.Hue = hue;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.Brightness = this.deviceStatus.payload.all.digest.light.luminance;
            this.ColorTemperature = this.deviceStatus.payload.all.digest.light.temperature;

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const saturation = hsl[1];
            this.platform.log.debug(
              'Retrieved saturation status successfully: ',
              saturation,
            );
            this.platform.log.debug(
              'Retrieved saturation/hue status successfully: ',
              this.Hue,
            );
            this.Saturation = saturation;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Saturation = this.On ? 100 : 0;
          }
        }
    }
  }

  async refreshStatus() {
    // Namespace
    switch (this.device.model) {
      case 'MSL-320':
        this.Namespace = 'Appliance.System.Online';
        break;
      default:
        this.Namespace = 'Appliance.System.All';
    }

    try {
      this.platform.log.debug('%s - Reading', this.device.model, `${this.device.deviceUrl}/status`);
      const deviceStatus = (
        await this.platform.axios({
          url: `http://${this.device.deviceUrl}/config`,
          method: 'post',
          data: {
            payload: {},
            header: {
              messageId: `${this.device.messageId}`,
              method: 'GET',
              from: `http://${this.device.deviceUrl}/config`,
              namespace: this.Namespace,
              timestamp: this.device.timestamp,
              sign: `${this.device.sign}`,
              payloadVersion: 1,
            },
          },
        },
        )).data;
      this.platform.log.debug(
        '%s %s refreshStatus -',
        this.device.model,
        this.accessory.displayName,
        JSON.stringify(deviceStatus),
      );
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e) {
      this.platform.log.error(
        '%s - Failed to refresh status of %s: %s',
        this.device.model,
        this.device.name,
        JSON.stringify(e.message),
        this.platform.log.debug('%s %s -', this.device.model, this.accessory.displayName, JSON.stringify(e)),
      );
      this.apiError(e);
    }
  }

  /**
 * Pushes the requested changes to the Meross Device
 */
  async pushOnChanges() {
    this.Payload = {
      togglex: {
        onoff: this.On ? 1 : 0,
        channel: `${this.device.channel}`,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.ToggleX',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    if (this.On) {
      this.Request = 'On';
    } else {
      this.Request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.Request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushBrightnessChanges() {
    // Payload
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'MSL-420':
        // Payload
        this.Payload = {
          light: {
            luminance: Number(this.Brightness),
            capacity: 4,
          },
        };
        break;
      case 'MSS560':
      default:
        this.Payload = {
          light: {
            luminance: Number(this.Brightness),
          },
        };
    }

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    this.platform.log.info('Sending request %s for %s', this.Brightness, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushColorTemperatureChanges() {
    // Payload
    this.Payload = {
      light: {
        temperature: this.mr_temp,
        capacity: 2,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    this.ColorTemperature = this.mr_temp;
    this.platform.log.info('Sending request %s for %s', this.Request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  async pushSaturationChanges() {
    // Payload
    this.Payload = {
      light: {
        rgb: this.rgb_d,
        capacity: 1,
        luminance: Number(this.Brightness),
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };

    // Make request
    const push = await this.platform.axios({
      url: `http://${this.device.deviceUrl}/config`,
      method: 'post',
      data: this.Data,
    },
    );
    if (this.On) {
      this.Request = 'On';
    } else {
      this.Request = 'Off';
    }
    this.platform.log.info('Sending request %s for %s', this.Request, this.accessory.displayName);
    this.platform.log.debug('%s %s Changes pushed -', this.device.model, this.accessory.displayName, JSON.stringify(push.data));
  }

  updateHomeKitCharacteristics() {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'MSL-420':
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
        if (this.Saturation !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.Saturation);
        }
        if (this.ColorTemperature !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.ColorTemperature);
        }
        if (this.Hue !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.Hue);
        }
        break;
      case 'MSS560':
      default:
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
    }
  }

  public apiError(e: any) {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'MSL-420':
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Saturation, e);
        this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Hue, e);
        break;
      case 'MSS560':
      default:
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
    }
  }

  /**
   * Handle requests to set the value of the "On" characteristic
   */
  OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set On: %s', this.device.model, this.accessory.displayName, value);

    this.On = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  BrightnessSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Brightness: %s', this.device.model, this.accessory.displayName, value);

    this.Brightness = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "ColorTemperature" characteristic
   */
  ColorTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set ColorTemperature: %s', this.device.model, this.accessory.displayName, value);

    this.ColorTemperature = value;
    this.mr_temp = Number(this.ColorTemperature) - 140;
    this.mr_temp = 360 - this.mr_temp;
    this.mr_temp = this.mr_temp / 360;
    this.mr_temp = Math.round(this.mr_temp * 100);
    this.mr_temp = this.mr_temp === 0 ? 1 : this.mr_temp;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  HueSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Hue: %s', this.device.model, this.accessory.displayName, value);

    this.Hue = value;
    this.doUpdate.next();
  }

  /**
   * Handle requests to set the value of the "Saturation" characteristic
   */
  SaturationSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Saturation: %s', this.device.model, this.accessory.displayName, value);

    this.Saturation = value;
    const rgb = HSLToRGB(this.Hue, this.Saturation, 50);
    this.rgb_d = colourToNumber(rgb[0], rgb[1], rgb[2]);
    this.doUpdate.next();
  }

}