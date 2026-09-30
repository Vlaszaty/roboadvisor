import { TableScroll } from './ChartFrame';
import { METRICS, formatMetric, formatMetricDelta, metricLabel, orderedMetricKeys } from './format';
import './results.css';

export interface MetricColumn {
  title: string;
  subtitle?: string;
  values: Record<string, number | null | undefined> | undefined;
}

/** Metrics as rows, runs as columns. With exactly two columns and `showDelta`, a "B − A" column is added. */
export function MetricsTable({
  columns, showDelta = false, caption, keys: onlyKeys,
}: {
  columns: MetricColumn[];
  showDelta?: boolean;
  caption: string;
  /** restrict to these metric keys, in this order */
  keys?: string[];
}) {
  const keys = onlyKeys ?? orderedMetricKeys(...columns.map((c) => c.values));
  const delta = showDelta && columns.length === 2;
  return (
    <TableScroll label={`${caption}, scrolls horizontally on small screens`}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {columns.map((c) => (
              <th key={c.title} scope="col" className="num">
                {c.title}
                {c.subtitle && <div className="small muted" style={{ fontWeight: 400 }}>{c.subtitle}</div>}
              </th>
            ))}
            {delta && <th scope="col" className="num">B − A</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row">
                {metricLabel(k)}
                {METRICS[k] && <div className="small muted" style={{ fontWeight: 400, whiteSpace: 'normal' }}>{METRICS[k].help}</div>}
              </th>
              {columns.map((c) => <td key={c.title} className="num">{formatMetric(k, c.values?.[k])}</td>)}
              {delta && <td className="num">{formatMetricDelta(k, columns[0].values?.[k], columns[1].values?.[k])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
