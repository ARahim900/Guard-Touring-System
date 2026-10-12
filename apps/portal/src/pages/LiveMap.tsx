// Live map: guards on shift (last GPS point), open SOS alerts, checkpoints.
import { Phone, RefreshCw } from 'lucide-react';

import { BaseMap, CheckpointLayer, FitBounds, GuardLayer, SosLayer } from '@/components/PatrolMap';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { guardName } from '@/lib/labels';
import { formatTime, relative } from '@/lib/time';
import { useLiveData } from '@/lib/useLiveData';

export default function LiveMapPage() {
  const { positions, alarms, checkpoints, updatedAt, reload } = useLiveData();
  // Fit to the checkpoints only: guard positions change every few seconds and
  // would keep re-zooming the map while a supervisor is looking at an SOS.
  const points: [number, number][] = checkpoints.map((c) => [c.latitude, c.longitude]);

  return (
    <>
      <PageHeader
        title="Live map"
        subtitle={updatedAt ? `Updated ${formatTime(updatedAt)} · refreshes automatically` : 'Loading…'}
        actions={<Button variant="outline" icon={RefreshCw} onClick={() => void reload()}>Refresh</Button>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="-m-5">
            <BaseMap className="h-[calc(100vh-220px)] min-h-[420px] w-full">
              <FitBounds points={points} />
              <CheckpointLayer checkpoints={checkpoints} />
              <GuardLayer positions={positions} />
              <SosLayer alarms={alarms} />
            </BaseMap>
          </div>
        </Card>
        <div className="space-y-4">
          {alarms.length ? (
            <Card title="Open SOS">
              <ul className="space-y-3">
                {alarms.map((a) => (
                  <li key={a.id} className="rounded-md border border-status-danger bg-danger-bg p-3">
                    <p className="font-semibold text-danger-text">{guardName(a)}</p>
                    <p className="text-xs text-danger-text">{relative(a.created_at)}</p>
                    {a.profiles?.phone ? (
                      <a href={`tel:${a.profiles.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-danger-text underline">
                        <Phone className="size-3" /> {a.profiles.phone}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card title={`Guards on shift (${positions.length})`}>
            {positions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guard is sharing a position right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {positions.map((p) => {
                  const stale = Date.now() - new Date(p.recorded_at).getTime() > 10 * 60 * 1000;
                  return (
                    <li key={p.guard_id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{p.full_name}</p>
                        {p.is_mocked ? <Badge label="Fake GPS" tone="danger" /> : stale ? <Badge label="No signal" tone="warning" /> : <Badge label="Live" tone="success" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{p.route_name} · {relative(p.recorded_at)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">“No signal” = no position for over 10 minutes (phone offline or switched off).</p>
          </Card>
        </div>
      </div>
    </>
  );
}
