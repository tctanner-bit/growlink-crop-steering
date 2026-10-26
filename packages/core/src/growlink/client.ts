import { UOM_HEADERS } from './enums';

export const GROWLINK_BASE_URL = 'https://api.developer.growlink.com';

export interface GlOrganization { id: string; name: string }
export interface GlRoom { id: string; name: string; roomType: number }
export interface GlSensor {
  id: string; name: string; sensorType: number; unitOfMeasure: number; metric: number;
  moduleId?: string; moduleName?: string;
}
export interface GlDevice {
  id: string; name: string; deviceType: number; interfaceType: number;
  [k: string]: unknown;
}
export interface GlSensorReading {
  sensorId: string; metric: number; unitOfMeasure: number; value: number | null;
  timestamp: string; suffix?: string;
}
export interface GlDeviceReading {
  deviceId: string; isActive: boolean | null; isManual: boolean | null;
  throttle: number | null; customValue?: unknown; timestamp: string;
}
export interface GlDeviceLogEntry { on: string; off: string; onDurationInSeconds: number; isManual: boolean }
export interface GlChartSeries {
  name: string; seriesType: number; unit: string;
  yAxis?: { min?: number; max?: number; tickAmount?: number };
  data: { x: string; y: number | null }[];
}
export interface GlTaskInput {
  title: string; description?: string; priority: number; tags?: string[];
  userId?: string | null; roomId?: string | null; dueTimestamp?: string | null;
}

export type DeviceCommand = true | false | 'auto' | number;

/**
 * The slice of the Growlink Developer API the autopilot uses. Implemented by the HTTP client
 * and by the simulator, so the controller code path is identical in every mode.
 */
export interface GrowlinkApi {
  listOrganizations(): Promise<GlOrganization[]>;
  listRooms(orgId: string): Promise<GlRoom[]>;
  listSensors(roomId: string): Promise<GlSensor[]>;
  listDevices(roomId: string): Promise<GlDevice[]>;
  liveSensors(orgId: string, sensorIds: string[]): Promise<GlSensorReading[]>;
  liveDevices(orgId: string, deviceIds: string[]): Promise<GlDeviceReading[]>;
  setDeviceState(roomId: string, deviceId: string, value: DeviceCommand): Promise<void>;
  sensorChart?(orgId: string, sensorIds: string[], start: string, end: string): Promise<{ series: GlChartSeries[]; dayNight: { x: string; y: number }[] }>;
  deviceLog?(orgId: string, deviceIds: string[], start: string, end: string): Promise<{ id: string; name: string; logs: GlDeviceLogEntry[] }[]>;
  createTask?(orgId: string, task: GlTaskInput): Promise<{ id: string }>;
  addTaskNote?(orgId: string, taskId: string, note: string): Promise<void>;
}

export class GrowlinkError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export function normalizeKeys<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map(normalizeKeys) as any;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k.charAt(0).toLowerCase() + k.slice(1)] = normalizeKeys(v);
    return out as T;
  }
  return value;
}

export function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  return (data?.[key] ?? []) as T[];
}

export const idKey = (id: string) => id.toLowerCase();

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpGrowlinkClient implements GrowlinkApi {
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(private opts: HttpClientOptions) {
    this.baseUrl = (opts.baseUrl ?? GROWLINK_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          'Gl-Api-Key': this.opts.apiKey,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...UOM_HEADERS,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e: any) {
      throw new GrowlinkError(e?.name === 'AbortError' ? 'Growlink API timed out' : 'Could not reach the Growlink API');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new GrowlinkError('Invalid API key', 401);
    if (!res.ok) throw new GrowlinkError(`Growlink API error ${res.status} on ${method} ${path}`, res.status);
    const text = await res.text();
    if (!text) return null;
    try { return normalizeKeys(JSON.parse(text)); } catch { return null; }
  }

  async listOrganizations() { return unwrapList<GlOrganization>(await this.request('GET', '/api/v2/organizations'), 'organizations'); }
  async listRooms(orgId: string) { return unwrapList<GlRoom>(await this.request('GET', `/api/v2/organization/${orgId}/rooms`), 'rooms'); }
  async listSensors(roomId: string) { return unwrapList<GlSensor>(await this.request('GET', `/api/v2/room/${roomId}/sensors`), 'sensors'); }
  async listDevices(roomId: string) { return unwrapList<GlDevice>(await this.request('GET', `/api/v2/room/${roomId}/devices`), 'devices'); }

  async liveSensors(orgId: string, sensorIds: string[]) {
    if (!sensorIds.length) return [];
    return unwrapList<GlSensorReading>(
      await this.request('POST', `/api/v2/organization/${orgId}/sensors/data/live`, { sensorIds }), 'sensorData');
  }

  async liveDevices(orgId: string, deviceIds: string[]) {
    if (!deviceIds.length) return [];
    return unwrapList<GlDeviceReading>(
      await this.request('POST', `/api/v2/organization/${orgId}/devices/data/live`, { deviceIds }), 'deviceData');
  }

  async setDeviceState(roomId: string, deviceId: string, value: DeviceCommand) {
    await this.request('PUT', `/api/v2/room/${roomId}/device/${deviceId}/state?value=${encodeURIComponent(String(value))}`);
  }

  async sensorChart(orgId: string, sensorIds: string[], start: string, end: string) {
    const d = await this.request('POST', `/api/v2/organization/${orgId}/sensors/data/chart`, { sensorIds, start, end, includeDayNight: true });
    return { series: (d?.series ?? []) as GlChartSeries[], dayNight: d?.dayNight ?? [] };
  }

  async deviceLog(orgId: string, deviceIds: string[], start: string, end: string) {
    const d = await this.request('POST', `/api/v2/organization/${orgId}/devices/data/log`, { deviceIds, start, end });
    return unwrapList<{ id: string; name: string; logs: GlDeviceLogEntry[] }>(d, 'devices');
  }

  async createTask(orgId: string, task: GlTaskInput) {
    const d = await this.request('POST', `/api/v2/organization/${orgId}/task`, task);
    return { id: String(d?.id ?? '') };
  }

  async addTaskNote(orgId: string, taskId: string, note: string) {
    await this.request('POST', `/api/v2/organization/${orgId}/task/${taskId}/note`, { note });
  }
}

/** Normalize an EC reading to mS/cm regardless of the unit the sensor reports. */
export function ecToMsCm(value: number, unitOfMeasure: number): number {
  if (unitOfMeasure === 33) return value / 1000; // μS/cm
  return value; // EC (mS/cm) and dS/m are numerically equal
}
