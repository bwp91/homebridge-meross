/* eslint-disable prefer-const */
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

export type data = {
  payload: payload;
  header: header;
};

export type payload = {
  togglex?: togglex;
  toggle?: toggle;
  light?: light;
  state?: state;
};

export type togglex = {
  onoff: number;
  channel: string;
};

export type toggle = {
  onoff: number;
};

export type light = {
  temperature?: number,
  rgb?: any,
  luminance?: number,
  capacity?: number,
};

export type state = {
  channel: string;
  open: number;
  uuid: string;
};

export type header = {
  messageId: string;
  method: string;
  from: string;
  namespace: string;
  timestamp: number | undefined;
  sign: string;
  payloadVersion: number;
  triggerSrc?: string;
};

export function HSLToRGB(h, s, l) {
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

export function RGBToHSL(r, g, b) {
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

// convert three r,g,b integers (each 0-255) to a single decimal integer (something between 0 and ~16m)
export function colourToNumber(r, g, b) {
  return (r << 16) + (g << 8) + b;
}

// convert it back again (to a string)
export function numberToColour(number) {
  const r = (number & 0xff0000) >> 16;
  const g = (number & 0x00ff00) >> 8;
  const b = number & 0x0000ff;
  return [r, g, b];
}