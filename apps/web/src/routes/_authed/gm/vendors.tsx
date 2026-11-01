import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { FormMessage } from '../../../components/FormMessage'
import { AddItemSearch } from '../../../components/gm/AddItemSearch'
import { GameIcon } from '../../../components/gm/GameIcon'
import { GmNav } from '../../../components/gm/GmNav'
import { VendorItemsTable } from '../../../components/gm/VendorItemsTable'
import { VendorList } from '../../../components/gm/VendorList'
import { gmVendorsQueryOptions, mapName, vendorDisplayName, vendorStockQueryOptions } from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/vendors')({
  validateSearch: (search: Record<string, unknown>): { vendor?: number } => {
    const vendor = Number(search.vendor)
    return Number.isInteger(vendor) && vendor > 0 ? { vendor } : { vendor: undefined }
  },
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: VendorsPage,
})

function VendorsPage() {
  const { vendor: selectedId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data, isError } = useQuery(gmVendorsQueryOptions)
  const selected = data?.vendors.find((vendor) => vendor.id === selectedId)
  const stock = useQuery({ ...vendorStockQueryOptions(selected?.id ?? 0), enabled: Boolean(selected) })
  const [note, setNote] = useState<string | null>(null)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <GmNav />
      <h1 className="text-4xl">Vendors</h1>
      {data?.database.endsWith('_TEST') && (
        <p className="mt-2 text-sm font-bold text-accent-text">
          Editing {data.database}. Players won't see this test copy.
        </p>
      )}
      <p className="mt-2 text-sm text-muted">Changes reach players after TMapSvr restarts.</p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError ? 'Could not load vendors.' : null} />
        {data && (
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="md:w-72 md:shrink-0">
              <VendorList
                vendors={data.vendors}
                selected={selectedId}
                onSelect={(vendor) => {
                  setNote(null)
                  void navigate({ search: { vendor } })
                }}
              />
            </div>
            <section className="min-w-0 flex-1">
              {selected ? (
                <>
                  <div className="flex items-center gap-3">
                    <GameIcon spriteId={selected.faceIcon} size={48} />
                    <div className="min-w-0">
                      <h2 className="text-2xl break-words">{vendorDisplayName(selected)}</h2>
                      <p className="text-sm text-muted">
                        {[selected.name && selected.title, selected.country, mapName(selected.mapId, selected.mapName)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  {note && <p className="mt-3 text-sm font-bold text-accent-text">{note}</p>}
                  <FormMessage message={stock.isError ? 'Could not load stock.' : null} />
                  {stock.data && (
                    <>
                      <AddItemSearch
                        key={`add-${selected.id}`}
                        vendor={selected}
                        soldItemIds={new Set(stock.data.map((item) => item.itemId))}
                        onNote={setNote}
                      />
                      <VendorItemsTable key={`stock-${selected.id}`} vendor={selected} items={stock.data} onNote={setNote} />
                    </>
                  )}
                </>
              ) : selectedId ? (
                <p className="text-muted">That NPC is not a vendor.</p>
              ) : (
                <p className="text-muted">Pick a vendor to see what they sell.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
