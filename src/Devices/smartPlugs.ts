import { Service, PlatformAccessory } from 'homebridge';
import { MerossPlatform } from '../platform';
import { MerossCloudDevice, DeviceDefinition } from 'meross-cloud';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class smartPlugs {
  private service: Service;

  On: any;
  doSmartPlugUpdate: any;

  constructor(
    private readonly platform: MerossPlatform,
    private accessory: PlatformAccessory,
    public deviceId: DeviceDefinition['uuid'],
    public deviceDef: DeviceDefinition,
    public device: MerossCloudDevice,
  ) {
    // default placeholders
    this.On;

    // Retrieve initial values and updateHomekit
    //this.refreshStatus();

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Meross')
      .setCharacteristic(this.platform.Characteristic.Model, this.deviceDef.deviceType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceDef.uuid)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.deviceDef.fmwareVersion);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    (this.service = this.accessory.getService(this.platform.Service.Outlet) || this.accessory.addService(this.platform.Service.Outlet)),
    `${this.deviceDef.devName} ${this.deviceDef.deviceType}`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, `${this.deviceDef.devName} ${this.deviceDef.deviceType}`);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/HumidifierDehumidifier

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));
    
    this.service.getCharacteristic(this.platform.Characteristic.OutletInUse)
      .on('get', this.handleOutletInUseGet.bind(this));
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleOnGet(callback) {
    this.platform.log.debug('Triggered GET On');

    // set this to a valid value for On
    const currentValue = 1;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  handleOnSet(value, callback) {
    this.platform.log.debug('Triggered SET On:', value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "Outlet In Use" characteristic
   */
  handleOutletInUseGet(callback) {
    this.platform.log.debug('Triggered GET OutletInUse');

    // set this to a valid value for OutletInUse
    const currentValue = 1;

    callback(null, currentValue);
  }
}
