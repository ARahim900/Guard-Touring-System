// =============================================================================
// Map building blocks (Leaflet with street and satellite basemaps).
// =============================================================================
// Markers are drawn as small HTML badges ("divIcon") rather than image pins.
// That avoids Leaflet's well-known broken-image problem with bundlers and lets
// us use brand colours directly.
// =============================================================================
import L from 'leaflet';
import { useEffect, type ReactNode } from 'react';
import { Circle, LayersControl, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { guardName } from '@/lib/labels';
import type { Alarm, Checkpoint, LivePosition } from '@/lib/types';
import { relative } from '@/lib/time';

/**
 * Starting view when there are no checkpoints yet: Muscat.
 * Once checkpoints exist, maps zoom to fit them automatically.
 */
export const DEFAULT_CENTER: [number, number] = [23.588, 58.383];
export const DEFAULT_ZOOM = 12;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const icons = {
  checkpoint: (label: string, done?: boolean) =>
    L.divIcon({
      className: '',
      html: `<div style="background:${done ? '#84B59F' : '#A4C5BB'};color:#4E4456;border:2px solid #4E4456;border-radius:6px;padding:1px 6px;font:600 14px 'Inter Variable',sans-serif;white-space:nowrap;transform:translate(-50%,-50%);display:inline-block">${escape(label)}</div>`,
      iconSize: [0, 0],
    }),
  guard: (name: string, stale: boolean) =>
    L.divIcon({
      className: '',
      html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
        <div style="background:${stale ? '#6B7280' : '#4E4456'};color:#fff;border-radius:6px;padding:2px 8px;font:600 14px 'Inter Variable',sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${escape(name)}</div>
        <div style="width:12px;height:12px;border-radius:50%;background:${stale ? '#6B7280' : '#4E4456'};border:3px solid #fff;margin-top:2px;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div></div>`,
      iconSize: [0, 0],
    }),
  sos: () =>
    L.divIcon({
      className: '',
      html: `<div style="position:relative;width:0;height:0">
        <span class="mb-ring" style="position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,.5)"></span>
        <span style="position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:#EF4444;border:3px solid #fff;color:#fff;font:700 9px sans-serif;display:flex;align-items:center;justify-content:center">SOS</span></div>`,
      iconSize: [0, 0],
    }),
};

export function BaseMap({ children, className, center, zoom, satellite = false }: { satellite?: boolean; children?: ReactNode; className?: string; center?: [number, number]; zoom?: number }) {
  return (
    <MapContainer center={center ?? DEFAULT_CENTER} zoom={zoom ?? DEFAULT_ZOOM} className={className ?? 'h-[480px] w-full rounded-lg'} scrollWheelZoom>
      <LayersControl position="topright" collapsed={false}>
      <LayersControl.BaseLayer checked={satellite} name="Satellite">
        <TileLayer
          attribution='Tiles &copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri</a> — Esri, Vantor, Earthstar Geographics, and the GIS User Community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={19}
          maxZoom={19}
        />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer checked={!satellite} name="Street">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      </LayersControl.BaseLayer>
      </LayersControl>
      {children}
    </MapContainer>
  );
}

/** Zoom the map once so that all given points are visible. */
export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 17);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 18 });
    // Only refit when the set of points changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export function CheckpointLayer({ checkpoints, doneIds }: { checkpoints: Checkpoint[]; doneIds?: Set<string> }) {
  return (
    <>
      {checkpoints.map((c) => (
        <span key={c.id}>
          <Circle center={[c.latitude, c.longitude]} radius={c.radius_m} pathOptions={{ color: '#4E4456', weight: 1, fillColor: '#A4C5BB', fillOpacity: 0.25 }} />
          <Marker position={[c.latitude, c.longitude]} icon={icons.checkpoint(c.name, doneIds?.has(c.id))}>
            <Popup>
              <strong>{c.name}</strong>
              <br />
              Code: {c.code}
              <br />
              Radius: {c.radius_m} m
            </Popup>
          </Marker>
        </span>
      ))}
    </>
  );
}

export function GuardLayer({ positions }: { positions: LivePosition[] }) {
  return (
    <>
      {positions.map((p) => {
        const stale = Date.now() - new Date(p.recorded_at).getTime() > 10 * 60 * 1000;
        return (
          <span key={p.guard_id}>
            {p.accuracy_m ? (
              <Circle center={[p.latitude, p.longitude]} radius={p.accuracy_m} pathOptions={{ color: '#6B9AC4', weight: 1, fillOpacity: 0.08 }} />
            ) : null}
            <Marker position={[p.latitude, p.longitude]} icon={icons.guard(p.full_name, stale)}>
              <Popup>
                <strong>{p.full_name}</strong>
                <br />
                Route: {p.route_name}
                <br />
                Last position: {relative(p.recorded_at)} (±{Math.round(p.accuracy_m ?? 0)} m)
                {p.is_mocked ? (
                  <>
                    <br />
                    <span style={{ color: '#7F1D1D', fontWeight: 600 }}>Fake GPS detected</span>
                  </>
                ) : null}
                {p.phone ? (
                  <>
                    <br />
                    <a href={`tel:${p.phone}`}>{p.phone}</a>
                  </>
                ) : null}
              </Popup>
            </Marker>
          </span>
        );
      })}
    </>
  );
}

export function SosLayer({ alarms }: { alarms: Alarm[] }) {
  return (
    <>
      {alarms
        .filter((a) => a.type === 'sos' && a.status !== 'resolved' && a.latitude !== null && a.longitude !== null)
        .map((a) => (
          <Marker key={a.id} position={[a.latitude!, a.longitude!]} icon={icons.sos()} zIndexOffset={1000}>
            <Popup>
              <strong>SOS · {guardName(a)}</strong>
              <br />
              {relative(a.created_at)}
              <br />
              {a.message}
            </Popup>
          </Marker>
        ))}
    </>
  );
}

/** Calls onPick with the clicked coordinates (used to place a checkpoint). */
export function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Moves the map to a point whenever `target` changes (e.g. another location is chosen). */
export function FlyTo({ target, zoom = 18 }: { target: [number, number] | null; zoom?: number }) {
  const map = useMap();
  const lat = target?.[0];
  const lng = target?.[1];
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.flyTo([lat, lng], zoom, { duration: 0.6 });
  }, [map, lat, lng, zoom]);
  return null;
}
