// =============================================================================
// Map for guards: where each patrol location (and its QR label) is.
// =============================================================================
// Locations still to visit are purple, verified ones green. "Show where I am"
// reads the phone's position once, only to draw it on this map; it is not
// saved or sent anywhere.
// =============================================================================
import L from 'leaflet';
import { Crosshair, Navigation } from 'lucide-react';
import { useState } from 'react';
import { Circle, Marker, Popup } from 'react-leaflet';

import { BaseMap, FitBounds, KeepInView } from '@/components/PatrolMap';
import type { PatrolCheckpoint } from '@/lib/guardPatrol';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pin = (label: string, done: boolean) => L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
    <div style="background:${done ? '#0D5C38' : '#4E4456'};color:#fff;border-radius:8px;padding:3px 8px;font:600 14px 'DM Sans Variable',sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${done ? '&#10003; ' : ''}${escape(label)}</div>
    <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${done ? '#0D5C38' : '#4E4456'}"></div></div>`,
  iconSize: [0, 0],
});

const me = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35)"></div>',
  iconSize: [0, 0],
});

export function GuardPatrolMap({ checkpoints }: { checkpoints: PatrolCheckpoint[] }) {
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const placed = checkpoints.filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && !(c.latitude === 0 && c.longitude === 0));
  const points = placed.map((c) => [c.latitude, c.longitude] as [number, number]);

  function locate() {
    setLocateError(null);
    if (!navigator.geolocation) return setLocateError('This phone cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
      () => { setLocating(false); setLocateError('Location is off. Allow location for this site in Settings, then try again.'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  if (!placed.length) return <p className="rounded-xl bg-muted px-4 py-3 text-sm">No location has a map position yet. Ask your supervisor to place them.</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-border">
        <BaseMap satellite className="h-[60vh] min-h-[320px] w-full">
          <FitBounds points={points} />
          <KeepInView target={position ? [position.lat, position.lng] : null} zoom={17} />
          {placed.map((c) => (
            <Marker key={c.checkpoint_id} position={[c.latitude, c.longitude]} icon={pin(c.checkpoint_name, c.completed)}>
              <Popup>
                <strong>{c.checkpoint_name}</strong>
                <br />
                {c.completed ? 'Verified' : 'Still to scan'}
                <br />
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer">Directions</a>
              </Popup>
            </Marker>
          ))}
          {position ? (
            <>
              <Circle center={[position.lat, position.lng]} radius={position.accuracy} pathOptions={{ color: '#2563EB', weight: 1, fillOpacity: 0.1 }} />
              <Marker position={[position.lat, position.lng]} icon={me} zIndexOffset={1000} />
            </>
          ) : null}
        </BaseMap>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={locate} disabled={locating} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-primary disabled:opacity-50">
          <Crosshair className={`size-4 ${locating ? 'animate-pulse' : ''}`} aria-hidden="true" />{locating ? 'Finding you…' : position ? 'Update where I am' : 'Show where I am'}
        </button>
        <p className="flex items-center gap-1 text-sm text-muted-foreground"><Navigation className="size-4" aria-hidden="true" />Tap a location for directions.</p>
      </div>
      {locateError ? <p role="alert" className="text-sm text-danger-text">{locateError}</p> : null}
    </div>
  );
}
