/* eslint-disable max-len */
import { PlatformConfig } from 'homebridge';
import { CloudOptions, MerossCloudDevice } from 'meross-cloud';

//Config
export interface MerossPlatformConfig extends PlatformConfig {
    devicediscovery?: boolean;
}

export interface MerossCloudConfig extends MerossPlatformConfig {
  user?: CloudOptions['email'];
  password?: CloudOptions['password'];
}

export interface MerossDevice extends MerossCloudDevice {
  uuid: string
  onlineStatus: number
  devName: string
  devIconId: string
  bindTime: number
  deviceType: string
  subType: string
  channels: any[]
  region: string
  fmwareVersion: string
  hdwareVersion: string
  userDevIcon: string
  iconType: number
  skillNumber: string
  domain: string
  reservedDomain: string
}


export interface AxiosRequestConfig {
  params?: Record<string, unknown>;
  headers?: any;
}