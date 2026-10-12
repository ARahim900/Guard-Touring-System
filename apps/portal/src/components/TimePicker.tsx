import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal } from '@/components/ui';

const hours = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const periods = ['AM', 'PM'];

function TimeWheel({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (value: string) => void;
}) {
  const id = useId();
  const wheel = useRef<HTMLDivElement>(null);
  const scrolling = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const selected = options.indexOf(value);

  useEffect(() => {
    if (!scrolling.current && wheel.current) wheel.current.scrollTop = selected * 44;
  }, [selected]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function choose(index: number) {
    scrolling.current = false;
    const next = Math.max(0, Math.min(options.length - 1, index));
    if (wheel.current) wheel.current.scrollTop = next * 44;
    onChange(options[next]);
  }

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-center text-sm text-muted-foreground">{label}</p>
      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-11 h-11 rounded-md bg-secondary-light" />
        <div ref={wheel} role="listbox" aria-label={label} aria-activedescendant={`${id}-${selected}`} tabIndex={0}
          className="relative h-[132px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-11 [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
          onScroll={(event) => {
            scrolling.current = true;
            window.clearTimeout(timer.current);
            const index = Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / 44)));
            onChange(options[index]);
            timer.current = window.setTimeout(() => { scrolling.current = false; }, 150);
          }}
          onKeyDown={(event) => {
            const index = event.key === 'ArrowDown' ? selected + 1 : event.key === 'ArrowUp' ? selected - 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
            if (index !== null) { event.preventDefault(); choose(index); }
          }}>
          {options.map((option, index) => <div key={option} id={`${id}-${index}`} role="option" aria-selected={option === value}
            onClick={() => choose(index)} className={`relative flex h-11 shrink-0 snap-center cursor-pointer items-center justify-center text-2xl tabular-nums ${option === value ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{option}</div>)}
        </div>
      </div>
    </div>
  );
}

export function TimePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('00:00');
  const [hour, minute] = draft.split(':').map(Number);
  const display = value ? `${Number(value.slice(0, 2)) % 12 || 12}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) >= 12 ? 'PM' : 'AM'}` : 'Choose time';
  const change = (nextHour: number, nextMinute: number) => setDraft(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Button type="button" variant="outline" className="min-h-12 w-full text-lg tabular-nums" aria-label={`${label}: ${display}`} onClick={() => { setDraft(value || '00:00'); setOpen(true); }}>{display}</Button>
      {createPortal(<Modal open={open} title={label} onClose={() => setOpen(false)} footer={<Button onClick={() => { onChange(draft); setOpen(false); }}>Use this time</Button>}>
        <p className="mb-4 text-sm text-muted-foreground">Muscat time · scroll or tap to choose.</p>
        <div className="flex gap-3">
          <TimeWheel label="Hour" options={hours} value={String(hour % 12 || 12).padStart(2, '0')} onChange={(v) => change(Number(v) % 12 + (hour >= 12 ? 12 : 0), minute)} />
          <TimeWheel label="Minute" options={minutes} value={String(minute).padStart(2, '0')} onChange={(v) => change(hour, Number(v))} />
          <TimeWheel label="AM or PM" options={periods} value={hour >= 12 ? 'PM' : 'AM'} onChange={(v) => change(hour % 12 + (v === 'PM' ? 12 : 0), minute)} />
        </div>
      </Modal>, document.body)}
    </div>
  );
}
