import { useMemo } from 'react';
import type { OrderBook, Position } from '@/lib/types';
import { useT } from '@/sidepanel/store';
import { PositionCard } from './PositionCard';

interface EventGroupProps {
  positions: Position[];
  books: Record<string, OrderBook>;
  multipliers: number[];
  lastUpdated: number;
}

interface GroupedPositions {
  eventId: string;
  title: string;
  positions: Position[];
}

function groupPositions(positions: Position[]): GroupedPositions[] {
  const groups = new Map<string, GroupedPositions>();

  for (const position of positions) {
    const eventId = position.eventId || position.conditionId;
    const existing = groups.get(eventId);

    if (existing) {
      existing.positions.push(position);
    } else {
      groups.set(eventId, {
        eventId,
        title: position.eventSlug || eventId,
        positions: [position],
      });
    }
  }

  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function EventGroup({ positions, books, multipliers, lastUpdated }: EventGroupProps) {
  const t = useT();
  const groups = useMemo(() => groupPositions(positions), [positions]);

  if (groups.length === 0) {
    return <div className="empty-state">{t('event.noPositions')}</div>;
  }

  return (
    <div className="event-groups">
      {groups.map((group) => (
        <section className="event-group" key={group.eventId}>
          <header className="event-group__header">
            <h2>{group.title}</h2>
            <span>{t(group.positions.length === 1 ? 'event.positionOne' : 'event.positionMany', { count: group.positions.length })}</span>
          </header>
          <div className="event-group__positions">
            {group.positions.map((position) => (
              <PositionCard
                book={books[position.asset] ?? null}
                key={position.asset}
                lastUpdated={lastUpdated}
                multipliers={multipliers}
                position={position}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
