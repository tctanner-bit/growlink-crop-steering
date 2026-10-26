// Numeric enums from the Growlink Developer API (cache locally, never resolve via API).

export const RoomType = { Production: 0, NonProduction: 1, Fertigation: 2 } as const;

export const SensorMetric = {
  Temperature: 0,
  Humidity: 1,
  PH: 2,
  CO2: 3,
  TDS: 4,
  FloatLevel: 5,
  LightLevel: 6,
  Battery: 7,
  VPD: 8,
  WaterContent: 9,
  EC: 10,
  FlowRate: 14,
  TankLevel: 29,
  TankVolume: 30,
} as const;

export const METRIC_LABELS: Record<number, string> = {
  0: 'Temperature', 1: 'Humidity', 2: 'pH', 3: 'CO2', 4: 'TDS', 5: 'Float Level',
  6: 'Light Level', 7: 'Battery', 8: 'VPD', 9: 'Water Content', 10: 'EC', 11: 'Voltage',
  12: 'Current', 13: 'Dissolved Oxygen', 14: 'Flow Rate', 15: 'Switch State',
  16: 'Vapor Pressure', 17: 'Atmospheric Pressure', 20: 'PAR', 22: 'DLI',
  23: 'Electrical Resistance', 27: 'Water Pressure', 28: 'ORP', 29: 'Tank Level',
  30: 'Tank Volume', 32: 'Auxiliary Flow Rate', 33: 'Injection Ratio',
  34: 'Stock Tank Concentration', 35: 'Light On/Off', 255: 'None',
};

export const DeviceType = {
  Irrigation: 12,
  Valve: 24,
  ExclusiveValve: 25,
  ReservoirPump: 2,
} as const;

export const DEVICE_TYPE_LABELS: Record<number, string> = {
  0: 'None', 1: 'Reservoir Chiller', 2: 'Reservoir Pump', 3: 'Light', 4: 'Fan', 5: 'Heater',
  6: 'Air Conditioner', 7: 'Humidifier', 8: 'Dehumidifier', 9: 'CO2 Burner', 10: 'CO2 Regulator',
  11: 'Exhaust Fan', 12: 'Irrigation', 13: 'Dosing Pump', 14: 'Reservoir Fill',
  15: 'Reservoir Drain', 16: 'Not in Use', 17: 'Light Analog', 18: 'Light PWM',
  19: 'Dosing Pump (Inline)', 20: 'Motor Vents', 21: 'Thermal Screen', 22: 'Shading Screen',
  23: 'Pad Pump', 24: 'Valve', 25: 'Exclusive Valve', 29: 'Batch Tank', 255: 'Unknown',
};

/** Device types that can carry an irrigation shot. */
export const IRRIGATION_DEVICE_TYPES = new Set<number>([2, 12, 24, 25]);

export const InterfaceType = {
  Default: 0,
  Numeric: 1,
  OnOff: 2,
  Percentage: 3,
  FourToTwenty: 4,
  ZeroToTen: 5,
  Bacnet: 6,
  Textbox: 7,
} as const;

/** Interface types that accept manual ON/OFF/AUTO commands. */
export const COMMANDABLE_INTERFACES = new Set<number>([0, 2, 3, 4, 5]);

export const UnitOfMeasure = { Percent: 4, EC: 6, DsPerM: 32, UsPerCm: 33, Liters: 43, Gallons: 42 } as const;

/** Unit-preference headers this app always sends: °C, kPa, EC, PPFD, liters. */
export const UOM_HEADERS: Record<string, string> = {
  'Uom-Temp': '0',
  'Uom-Vpd': '8',
  'Uom-Tds': '6',
  'Uom-Light': '16',
  'Uom-Volume': '43',
};

export const TaskPriority = { High: 1, Medium: 2, Low: 4 } as const;
