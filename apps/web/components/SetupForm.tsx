'use client';

import { Button, Textfield, TextArea, Toggle, SectionMessage, Heading } from '@/components/ui';
import { useState, useTransition } from 'react';
import { DEVICE_TYPE_LABELS, pctPerSecond, DEFAULT_ROOM_CONFIG } from '@gl-steering/core';
import { saveRoomSetup, sendCommand, RoomSetupInput, ActionResult } from '@/app/actions';

interface Opt { id: string; name: string; meta: string }

export function SetupForm(props: {
  roomId: string; mode: string; wcSensors: Opt[]; ecSensors: Opt[];
  devices: (Opt & { irrigation: boolean; deviceType: number })[];
  initial: RoomSetupInput; defaultFloor: number; isDemo: boolean;
  lightsSyncedAt: string | null; lightsSyncNote: string | null;
}) {
  const [v, setV] = useState<RoomSetupInput>(props.initial);
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const synced = v.lightsSync && !props.isDemo;
  const set = <K extends keyof RoomSetupInput>(k: K, val: RoomSetupInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const setAll = (k: 'wcSensorIds' | 'ecSensorIds', ids: string[]) => setV((x) => ({ ...x, [k]: ids }));
  const AllToggle = ({ list, opts }: { list: 'wcSensorIds' | 'ecSensorIds'; opts: Opt[] }) => {
    if (opts.length < 2) return null;
    const all = opts.every((o) => v[list].includes(o.id));
    return (
      <button type="button" className="gl-btn gl-btn--subtle gl-btn--compact" onClick={() => setAll(list, all ? [] : opts.map((o) => o.id))}>
        {all ? 'Deselect all' : 'Select all'}
      </button>
    );
  };
  const toggle = (k: 'wcSensorIds' | 'ecSensorIds' | 'valveIds', id: string) =>
    setV((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((i) => i !== id) : [...x[k], id] }));
  const num = (k: keyof RoomSetupInput) => (e: React.FormEvent<HTMLInputElement>) => set(k, Number((e.target as HTMLInputElement).value) as any);

  const devices = showAll ? props.devices : props.devices.filter((d) => d.irrigation || v.valveIds.includes(d.id));
  const secPer1pct = 1 / pctPerSecond({ ...DEFAULT_ROOM_CONFIG, blockVolumeL: v.blockVolumeL, emitterFlowMlPerMin: v.emitterFlowMlPerMin, emittersPerBlock: v.emittersPerBlock });

  const Check = ({ list, o }: { list: 'wcSensorIds' | 'ecSensorIds' | 'valveIds'; o: Opt & { deviceType?: number } }) => (
    <label className="check">
      <input type="checkbox" checked={v[list].includes(o.id)} onChange={() => toggle(list, o.id)} />
      <span>{o.name}</span>
      <span className="check-meta">{o.deviceType != null ? DEVICE_TYPE_LABELS[o.deviceType] ?? '' : o.meta}</span>
    </label>
  );

  return (
    <form className="stack gap-300" onSubmit={(e) => { e.preventDefault(); start(async () => setMsg(await saveRoomSetup(props.roomId, v))); }}>
      <div className="card stack gap-200">
        <Heading size="small" as="h2">Sensors</Heading>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="stack gap-100">
            <div className="row spread gap-100"><span className="field-label">Substrate water content (required) · {v.wcSensorIds.length} of {props.wcSensors.length}</span><AllToggle list="wcSensorIds" opts={props.wcSensors} /></div>
            <div className="checklist">
              {props.wcSensors.length ? props.wcSensors.map((o) => <Check key={o.id} list="wcSensorIds" o={o} />) : <span className="small muted">No water-content sensors in this room.</span>}
            </div>
            <span className="field-help">Averaged per tick; a probe more than 8% from the median is ignored.</span>
          </div>
          <div className="stack gap-100">
            <div className="row spread gap-100"><span className="field-label">Substrate EC (recommended) · {v.ecSensorIds.length} of {props.ecSensors.length}</span><AllToggle list="ecSensorIds" opts={props.ecSensors} /></div>
            <div className="checklist">
              {props.ecSensors.length ? props.ecSensors.map((o) => <Check key={o.id} list="ecSensorIds" o={o} />) : <span className="small muted">No EC sensors in this room.</span>}
            </div>
            <span className="field-help">Drives refresh volume against the phase's substrate-EC targets.</span>
          </div>
        </div>
      </div>

      <div className="card stack gap-200">
        <div className="row spread">
          <Heading size="small" as="h2">Irrigation valves</Heading>
          <label className="row gap-050 small subtle"><Toggle isChecked={showAll} onChange={() => setShowAll((x) => !x)} label="Show all devices" />Show all controllable devices</label>
        </div>
        <div className="checklist">
          {devices.length ? devices.map((o) => <Check key={o.id} list="valveIds" o={o} />) : <span className="small muted">No irrigation devices found. Toggle “Show all” if your valves use another device type.</span>}
        </div>
        <div className="form-grid">
          <label className="row gap-100"><Toggle isChecked={v.sequentialValves} onChange={() => set('sequentialValves', !v.sequentialValves)} label="Sequential" /><span>Run zones one at a time</span></label>
          <div className="field">
            <span className="field-label">Between shots, valves rest in</span>
            <div className="segmented" role="group">
              <button type="button" aria-pressed={v.restState === 'off'} onClick={() => set('restState', 'off')}>Forced OFF</button>
              <button type="button" aria-pressed={v.restState === 'auto'} onClick={() => set('restState', 'auto')}>AUTO</button>
            </div>
            <span className="field-help">Forced OFF stops any Growlink program from also irrigating. Use AUTO only if those valves have no irrigation program.</span>
          </div>
        </div>
      </div>

      <div className="card stack gap-200">
        <Heading size="small" as="h2">Schedule and substrate</Heading>
        {!props.isDemo && (
          <div className="stack gap-100">
            <div className="row gap-150 wrap">
              <label className="row gap-100">
                <Toggle isChecked={v.lightsSync} onChange={() => set('lightsSync', !v.lightsSync)} label="Keep lights in sync with Growlink" />
                <span>Keep the lights schedule in sync with Growlink</span>
              </label>
              <span className="grow" />
              {v.lightsSync && (
                <Button spacing="compact" isDisabled={pending} onClick={() => start(async () => { const r = await sendCommand(props.roomId, 'sync_lights'); setSyncMsg(r.ok ? 'Syncing — refresh in a few seconds.' : r.error ?? 'Failed'); })}>Sync now</Button>
              )}
            </div>
            <span className="field-help" suppressHydrationWarning>
              {syncMsg ?? (!v.lightsSync ? 'Off: lights-on and photoperiod are set by hand below.'
                : props.lightsSyncNote ? props.lightsSyncNote
                : props.lightsSyncedAt ? `Read from the room's day/night schedule in Growlink · last checked ${new Date(props.lightsSyncedAt).toLocaleString()}. Checked every 30 minutes; a flip to flower is picked up after the first full 12 h day.`
                : 'Read from the room\'s day/night schedule in Growlink within a minute of saving, then every 30 minutes.')}
            </span>
          </div>
        )}
        <div className="form-grid">
          <Field label="Lights on (local)" help={synced ? 'From Growlink' : '24 h, HH:MM'}><Textfield value={v.lightsOn} isDisabled={synced} onChange={(e) => set('lightsOn', (e.target as HTMLInputElement).value)} /></Field>
          <Field label="Photoperiod (h)" help={synced ? 'From Growlink' : '12 for flower, 18 for veg'}><Textfield type="number" step="0.25" value={String(v.photoperiodHours)} isDisabled={synced} onChange={num('photoperiodHours')} /></Field>
          <Field label="Time zone" help="IANA name, e.g. America/Denver"><Textfield value={v.timezone} onChange={(e) => set('timezone', (e.target as HTMLInputElement).value)} /></Field>
          <Field label="Block volume (L)" help="6×6×4 in block ≈ 2.4 L"><Textfield type="number" step="0.1" value={String(v.blockVolumeL)} onChange={num('blockVolumeL')} /></Field>
          <Field label="Emitter flow (ml/min)" help="2 L/h dripper = 33 ml/min"><Textfield type="number" step="1" value={String(v.emitterFlowMlPerMin)} onChange={num('emitterFlowMlPerMin')} /></Field>
          <Field label="Emitters per block"><Textfield type="number" step="1" value={String(v.emittersPerBlock)} onChange={num('emittersPerBlock')} /></Field>
        </div>
        <div className="small subtle">≈ {secPer1pct.toFixed(0)} s of irrigation raises a block 1% WC before calibration. The engine re-calibrates from each shot&apos;s measured response.</div>
      </div>

      <div className="card stack gap-200">
        <Heading size="small" as="h2">Safety limits</Heading>
        <div className="form-grid">
          <Field label="Min shot (s)"><Textfield type="number" value={String(v.minShotSeconds)} onChange={num('minShotSeconds')} /></Field>
          <Field label="Max shot (s)" help="Hard ceiling ≤ 900 s"><Textfield type="number" value={String(v.maxShotSeconds)} onChange={num('maxShotSeconds')} /></Field>
          <Field label="Emergency WC floor (%)" help={`Blank = phase default (${props.defaultFloor}%)`}>
            <Textfield type="number" value={v.emergencyWcFloor == null ? '' : String(v.emergencyWcFloor)}
              onChange={(e) => { const s = (e.target as HTMLInputElement).value; set('emergencyWcFloor', s === '' ? null : Number(s)); }} />
          </Field>
        </div>
      </div>

      <div className="card stack gap-200">
        <Heading size="small" as="h2">Nova</Heading>
        <Field label="Grower notes for Nova" help="Cultivar habits, constraints, what you are steering for. Included in every review.">
          <TextArea value={v.growerNotes} onChange={(e) => set('growerNotes', e.target.value)} minimumRows={3} />
        </Field>
        {!props.isDemo && (
          <label className="row gap-100"><Toggle isChecked={v.postToTasks} onChange={() => set('postToTasks', !v.postToTasks)} label="Post reviews" /><span>Post each daily review as a Growlink task on this room</span></label>
        )}
      </div>

      {msg && (msg.ok ? <SectionMessage appearance="success">{msg.message}</SectionMessage> : <SectionMessage appearance="error">{msg.error}</SectionMessage>)}
      <div className="row gap-100">
        <Button type="submit" appearance="primary" isLoading={pending}>Save setup</Button>
        {props.mode === 'live' && <span className="small" style={{ color: 'var(--ds-text-warning)' }}>Room is Live — changes apply on the next tick.</span>}
      </div>
    </form>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div className="field"><span className="field-label">{label}</span>{children}{help && <span className="field-help">{help}</span>}</div>;
}
