import { Price } from '../gm/Price'
import { PERCENTILES, RUNS, stuckText, type Count, type SimulationRun } from '../../lib/upgrade-runs'

const ROWS: { count: Count; name: string }[] = [
  { count: 'attempts', name: 'Attempts' },
  { count: 'potions', name: 'Serendipity' },
  { count: 'tinctures', name: 'Tinctures' },
  { count: 'reflections', name: 'Reflections' },
  { count: 'cost', name: 'Cost' },
]

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })
const share = (part: number, whole: number) => `${number((part / whole) * 100)}%`

export function SimulationResults({ result }: { result: SimulationRun }) {
  const { runs, reached, destroyed, stuck, spread, from, target, priced } = result
  // With no price filled in, a row of zeros would say the upgrade is free.
  const rows = ROWS.filter(({ count }) => priced || count !== 'cost')

  return (
    <section aria-label="Simulation results" className="flex flex-col gap-3 rounded-xs border border-line bg-surface p-5">
      <h2 className="text-xl font-bold">
        {number(runs)} runs from +{from} to +{target}
      </h2>
      {stuck && <p className="text-sm text-danger">{stuckText(target)}</p>}
      {!stuck && runs < RUNS && (
        <p className="text-sm text-muted">Stopped early, because this setup takes very long. Fewer runs make the numbers below less exact.</p>
      )}
      {runs > 0 && (
        <p>
          Reached +{target} in {share(reached, runs)} of runs.{destroyed > 0 && ` The item was destroyed in ${share(destroyed, runs)}.`}
        </p>
      )}
      {spread && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
                    Used
                  </th>
                  {['Average', ...PERCENTILES.map((percent) => `p${percent}`)].map((heading) => (
                    <th key={heading} scope="col" className="px-2 pb-2 text-right text-xs font-bold tracking-wider text-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ count, name }) => (
                  <tr key={count} className="border-t border-line">
                    <th scope="row" className="px-2 py-1.5 font-bold">
                      {name}
                    </th>
                    {[spread[count].mean, ...spread[count].percentiles].map((value, index) => (
                      <td key={index} className="px-2 py-1.5 text-right tabular-nums">
                        {count === 'cost' ? <Price price={Math.round(value)} shop="money" /> : number(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            Only runs that reached +{target} are counted. p50 is the middle run, and p90 means 9 in 10 runs needed this many or fewer.
            {priced && ' Cost is at your prices, without the upgrade fee the NPC takes.'}
          </p>
        </>
      )}
    </section>
  )
}
