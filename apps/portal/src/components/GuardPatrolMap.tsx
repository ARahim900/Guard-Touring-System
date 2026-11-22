// =============================================================================
// Map for guards: where each patrol location (and its QR label) is.
// =============================================================================
// Purple = still to scan, green = verified, amber = scanned but not verified yet
// (saved on the phone or awaiting review). "Show where I am" reads the phone's
// position once, only to draw it here; it is not saved or sent anywhere.
// =============================================================================
import L from 'leaflet';
import { Crosshair } from 'lucide-react';
import { useState } from 'react';
import { Circle, Marker, Popup } from 'react-leaflet';

import { BaseMap, FitBounds, KeepInView } from '@/components/PatrolMap';
import { isPlaced } from '@/lib/geo';
import type { PatrolCheckpoint } from '@/lib/guardPatrol';

export type PinState = 'todo' | 'done' | 'waiting';
export interface MyPosition { lat: number; lng: number; accuracy: number }

const COLOUR: Record<PinState, string> = { todo: '#4E4456', done: '#0D5C38', waiting: '#8A5A00' };
const STATE_TEXT: Record<PinState, string> = { todo: 'Still to scan', done: 'Verified', waiting: 'Scanned, not verified yet' };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pin = (label: string, state: PinState) => L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
    <div style="background:${COLOUR[state]};color:#fff;border-radius:8px;padding:3px 8px;font:600 14px 'DM Sans Variable',sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${state === 'done' ? '&#10003; ' : ''}${escape(label)}</div>
    <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${COLOUR[state]}"></div></div>`,
  iconSize: [0, 0],
});

const me = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35)"></div>',
  iconSize: [0, 0],
});

const defaultState = (c: PatrolCheckpoint): PinState => (c.completed ? 'done' : 'todo');

export function GuardPatrolMap({ checkpoints, stateOf = defaultState, position, onPosition, className = 'h-[60vh] min-h-[320px] w-full' }: {
  checkpoints: PatrolCheckpoint[];
  stateOf?: (checkpoint: PatrolCheckpoint) => PinState;
  position?: MyPosition | null;
  onPosition?: (position: MyPosition) => void;
  className?: string;
}) {
  const [ownPosition, setOwnPosition] = useState<MyPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const shown = position ?? ownPosition;
  const placed = checkpoints.filter((c) => isPlaced(c.latitude, c.longitude));
  const points = placed.map((c) => [c.latitude, c.longitude] as [number, number]);

  function locate() {
    setLocateError(null);
    if (!navigator.geolocation) return setLocateError('This phone cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setOwnPosition(next);
        onPosition?.(next);
      },
      () => { setLocating(false); setLocateError('Location is off. Allow location for this site in Settings, then try again.'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  if (!placed.length) return <p className="rounded-xl bg-muted px-4 py-3 text-sm">No location has a map position yet. Ask your supervisor to place them.</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-border">
        <BaseMap satellite className={className}>
          <FitBounds points={points} />
          <KeepInView target={shown ? [shown.lat, shown.lng] : null} zoom={17} />
          {placed.map((c) => {
            const state = stateOf(c);
            return (
              <Marker key={c.checkpoint_id} position={[c.latitude, c.longitude]} icon={pin(c.checkpoint_name, state)}>
                <Popup>
                  <strong>{c.checkpoint_name}</strong>
                  <br />
                  {STATE_TEXT[state]}
                  <br />
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer">Directions</a>
                </Popup>
              </Marker>
            );
          })}
          {shown ? (
            <>
              <Circle center={[shown.lat, shown.lng]} radius={shown.accuracy} pathOptions={{ color: '#2563EB', weight: 1, fillOpacity: 0.1 }} />
              <Marker position={[shown.lat, shown.lng]} icon={me} zIndexOffset={1000} />
            </>
          ) : null}
        </BaseMap>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={locate} disabled={locating} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-primary disabled:opacity-50">
          <Crosshair className={`size-4 ${locating ? 'animate-pulse' : ''}`} aria-hidden="true" />{locating ? 'Finding you…' : shown ? 'Update where I am' : 'Show where I am'}
        </button>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground" aria-label="Map key">
          {(Object.keys(COLOUR) as PinState[]).map((state) => <li key={state} className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-full" style={{ background: COLOUR[state] }} />{STATE_TEXT[state]}</li>)}
        </ul>
      </div>
      {locateError ? <p role="alert" className="text-sm text-danger-text">{locateError}</p> : null}
    </div>
  );
}
