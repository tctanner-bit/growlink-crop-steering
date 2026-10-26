'use client';

import { useState, useTransition } from 'react';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import SectionMessage from '@atlaskit/section-message';
import { checkApiKey, createConnection } from '@/app/actions';

export function ConnectWizard() {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const [org, setOrg] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="card stack gap-200">
      <div className="field">
        <span className="field-label">API key</span>
        <Textfield type="password" autoComplete="off" value={key} onChange={(e) => { setKey((e.target as HTMLInputElement).value); setOrgs(null); }} placeholder="Gl-Api-Key" />
      </div>
      {!orgs && (
        <div><Button appearance="primary" isLoading={pending} isDisabled={!key.trim()} onClick={() => start(async () => {
          setErr(null);
          const r = await checkApiKey(key);
          if (r.ok) { setOrgs(r.orgs); setOrg(r.orgs[0].id); setLabel(r.orgs[0].name); } else setErr(r.error);
        })}>Verify key</Button></div>
      )}
      {orgs && (
        <>
          <div className="field">
            <span className="field-label">Organization</span>
            <div className="checklist">
              {orgs.map((o) => (
                <label key={o.id} className="check">
                  <input type="radio" name="org" checked={org === o.id} onChange={() => { setOrg(o.id); setLabel(o.name); }} />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Label</span>
            <Textfield value={label} onChange={(e) => setLabel((e.target as HTMLInputElement).value)} />
          </div>
          <div><Button appearance="primary" isLoading={pending} onClick={() => start(async () => {
            const o = orgs.find((x) => x.id === org)!;
            const r = await createConnection(key, o.id, o.name, label);
            if (r && !r.ok) setErr(r.error);
          })}>Save connection</Button></div>
        </>
      )}
      {err && <SectionMessage appearance="error">{err}</SectionMessage>}
    </div>
  );
}
