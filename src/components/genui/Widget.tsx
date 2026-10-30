'use client';

import type { ReactNode } from 'react';
import type { WidgetSpec } from '@/lib/genui/spec';
import { ChartView } from './ChartView';
import { DataTable } from './DataTable';
import { KpiTiles } from './KpiTiles';
import { WidgetCard } from './WidgetCard';

type Props = {
  widget: WidgetSpec;
  pinnable?: boolean;
  /** Grid tile mode: fill the tile and make the header the drag handle. */
  fill?: boolean;
  actions?: ReactNode;
  handleClassName?: string;
};

export function Widget({ widget, pinnable = true, fill, actions, handleClassName }: Props) {
  const tile = { fill, actions, handleClassName };
  switch (widget.kind) {
    case 'chart':
      return <ChartView spec={widget.spec} pinnable={pinnable} {...tile} />;
    case 'kpis':
      return <KpiTiles spec={widget.spec} pinnable={pinnable} {...tile} />;
    case 'table':
      return (
        <WidgetCard title={widget.spec.title} widget={pinnable ? widget : undefined} {...tile}>
          <DataTable {...widget.spec} fill={fill} />
        </WidgetCard>
      );
  }
}
