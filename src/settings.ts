import { PlatformConfig } from 'homebridge';

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'Meross';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-meross';

//Config
export interface MerossCloudPlatformConfig extends PlatformConfig {
  devicediscovery?: boolean;
  refreshRate?: number;
  pushRate?: number;
  devices?: Array<DevicesConfig>;
}

export type DevicesConfig = {
  name?: string;
  model?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  deviceUrl?: string;
  channel?: number;
  messageId?: string;
  timestamp?: number;
  sign?: string;
  garageDoorOpeningTime?: number;
};