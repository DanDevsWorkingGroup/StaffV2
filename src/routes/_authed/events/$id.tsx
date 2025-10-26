import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'

const getEvent = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = getSupabaseServerClient()
    
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()

    return { event }
  })

export const Route = createFileRoute('/_authed/events/$id')({
  loader: async ({ params }) => await getEvent({ data: params.id }),
  component: EventDetailPage,
})

function EventDetailPage() {
  const { event } = Route.useLoaderData()
  
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold">{event.name}</h1>
        <p className="text-gray-600 mt-2">{event.category}</p>
        <div className="mt-4">
          <p><strong>Start:</strong> {event.start_date}</p>
          <p><strong>End:</strong> {event.end_date}</p>
          {event.description && (
            <p className="mt-4">{event.description}</p>
          )}
        </div>
      </div>
    </div>
  )
}