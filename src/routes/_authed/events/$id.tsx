import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'

const getEventWithTrainers = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = getSupabaseServerClient()

    // Get the event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()

    if (eventError || !event) {
      console.error('❌ Event not found:', eventError)
      return {
        event: null,
        assignedTrainers: [],
        error: 'Event not found'
      }
    }

    console.log('📅 Event loaded:', event.name, '(ID:', id, ')')
    console.log('📆 Date range:', event.start_date, 'to', event.end_date)

    // ✅ FIXED: Now filters by event name in database query
    const { data: schedules, error: schedulesError } = await supabase
      .from('schedules')
      .select(`
        trainer_id,
        trainers (
          id,
          name,
          rank,
          specialization,
          status
        )
      `)
      .gte('date', event.start_date)
      .lte('date', event.end_date)
      .ilike('notes', `%${event.name}%`)  // ✅ FIX: Filter by event name in DB
      .eq('status', 'scheduled')          // ✅ FIX: Only scheduled entries

    console.log('📋 Schedules query returned:', schedules?.length || 0, 'entries')

    if (schedulesError) {
      console.error('❌ Schedules query error:', schedulesError)
      return {
        event,
        assignedTrainers: [],
        error: schedulesError.message
      }
    }

    // ✅ FIXED: Simplified deduplication logic with null checks
    const trainersMap = new Map()

    if (schedules && schedules.length > 0) {
      schedules.forEach((schedule: any) => {
        // Validate trainer data exists (handles JOIN failures)
        if (schedule.trainers && schedule.trainer_id) {
          // Only add if not already in map (removes duplicates)
          if (!trainersMap.has(schedule.trainer_id)) {
            trainersMap.set(schedule.trainer_id, schedule.trainers)
            console.log('✅ Added trainer:', schedule.trainers.name, '(ID:', schedule.trainer_id, ')')
          }
        } else {
          console.warn('⚠️ Schedule missing trainer data:', {
            trainer_id: schedule.trainer_id,
            has_trainer_object: !!schedule.trainers
          })
        }
      })
    } else {
      console.log('ℹ️ No schedules found for this event')
    }

    const assignedTrainers = Array.from(trainersMap.values())

    console.log('👥 Final trainer count:', assignedTrainers.length)
    console.log('📝 Trainer names:', assignedTrainers.map(t => t.name).join(', '))

    return { event, assignedTrainers, error: null }
  })

// Delete event — ADMIN / COORDINATOR / EVENT COORDINATOR only (enforced server-side)
const deleteEvent = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'])

    const supabase = getSupabaseServerClient()

    console.log('🗑️ Starting delete process for event ID:', id)

    // ✅ FIX 1: First, get the event to know its name
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('name')
      .eq('id', id)
      .single()

    if (fetchError || !event) {
      console.error('❌ Failed to fetch event:', fetchError)
      throw new Error('Event not found')
    }

    console.log('📅 Found event:', event.name)

    // ✅ FIX 2: Delete schedules using EVENT NAME (not ID!)
    const { data: deletedSchedules, error: scheduleError } = await supabase
      .from('schedules')
      .delete()
      .ilike('notes', `%${event.name}%`)  // ✅ Use event NAME, not ID
      .select()  // ✅ Return deleted rows to verify

    if (scheduleError) {
      console.error('❌ Failed to delete schedules:', scheduleError)
      throw new Error(`Failed to delete schedules: ${scheduleError.message}`)
    }

    console.log(`📋 Deleted ${deletedSchedules?.length || 0} schedule entries`)

    // ✅ FIX 3: Delete the event and CHECK if it was actually deleted
    const { data: deletedEvent, error: deleteError } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .select()  // ✅ Return deleted row to verify

    if (deleteError) {
      console.error('❌ Delete error:', deleteError)
      throw new Error(`Failed to delete event: ${deleteError.message}`)
    }

    // ✅ FIX 4: Check the event actually existed / was deleted
    if (!deletedEvent || deletedEvent.length === 0) {
      console.error('❌ Event was not deleted (already gone?)')
      throw new Error('Event not found or already deleted')
    }

    console.log('✅ Successfully deleted event:', event.name)
    return { success: true, deletedSchedules: deletedSchedules?.length || 0 }
  })

export const Route = createFileRoute('/_authed/events/$id')({
  loader: async ({ params }) => await getEventWithTrainers({ data: params.id }),
  component: EventDetailPage,
})

function EventDetailPage() {
  const { event, assignedTrainers } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()

  // Who may edit / delete an event (FSD §5.1)
  function canManage(role?: string): boolean {
    return role === 'ADMIN' || role === 'COORDINATOR' || role === 'EVENT COORDINATOR'
  }

  // ✅ FIXED: Delete handler with better error handling
  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${event.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      const result = await deleteEvent({ data: event.id.toString() })
      alert(`Event deleted successfully! (Removed ${result.deletedSchedules} schedule entries)`)
      navigate({ to: '/events' })
    } catch (error: any) {
      console.error('Delete error:', error)

      if (error.message?.includes('Forbidden') || error.message?.includes('Unauthorized')) {
        alert('Permission Denied: only Admins, Coordinators and Event Coordinators can delete events.')
      } else {
        alert(`Failed to delete event: ${error.message || 'Unknown error'}`)
      }
    }
  }

  // Handle error case
  if (!event) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p className="font-semibold">Error Loading Event</p>
          <p className="text-sm mt-1">The event could not be found or loaded.</p>
        </div>
        <button
          onClick={() => window.history.back()}
          className="mt-4 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          ← Go Back
        </button>
      </div>
    )
  }

  // Calculate event duration
  const startDate = new Date(event.start_date)
  const endDate = new Date(event.end_date)
  const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

  // Format dates
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div
          className="h-3"
          style={{ backgroundColor: event.color }}
        />
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.name}</h1>
              <div className="flex items-center space-x-2">
                <span
                  className="px-3 py-1 rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: event.color }}
                >
                  {event.category}
                </span>
              </div>
            </div>
            <div>
              {/* Status Badge */}
              {new Date(event.end_date) < new Date() ? (
                <span className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold">
                  Past Event
                </span>
              ) : new Date(event.start_date) <= new Date() ? (
                <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-semibold">
                  Ongoing
                </span>
              ) : (
                <span className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-semibold">
                  Upcoming
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons - event managers only (FSD §5.1) */}
          {canManage(user?.role) && (
            <div className="flex gap-3 mb-6 pb-6 border-b">
              <Link
                to="/events/edit/$id"
                params={{ id: event.id.toString() }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Edit Event</span>
              </Link>

              {/* Delete button — same roles as Edit (FSD §5.1) */}
              {canManage(user?.role) && (
                <button
                  onClick={handleDelete}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center justify-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Delete Event</span>
                </button>
              )}
            </div>
          )}

          {/* Date Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <svg className="w-6 h-6 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-gray-600">Start Date</p>
                  <p className="text-base text-gray-900">{formatDate(event.start_date)}</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <svg className="w-6 h-6 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-gray-600">End Date</p>
                  <p className="text-base text-gray-900">{formatDate(event.end_date)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <svg className="w-6 h-6 text-purple-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-gray-600">Duration</p>
                  <p className="text-base text-gray-900">
                    {duration} {duration === 1 ? 'day' : 'days'}
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <svg className="w-6 h-6 text-green-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-gray-600">Assigned Trainers</p>
                  <p className="text-base text-gray-900 font-bold text-lg">
                    {assignedTrainers.length} {assignedTrainers.length === 1 ? 'trainer' : 'trainers'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {event.description && (
            <div className="mt-6 pt-6 border-t">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Description</h2>
              <p className="text-gray-700 leading-relaxed">{event.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Assigned Trainers Section */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h2 className="text-xl font-bold text-white">Assigned Trainers</h2>
            </div>
            <span className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-semibold">
              {assignedTrainers.length} Total
            </span>
          </div>
        </div>

        <div className="p-6">
          {assignedTrainers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assignedTrainers.map((trainer: any) => (
                <div
                  key={trainer.id}
                  className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md transition"
                >
                  <div className="flex items-start space-x-3">
                    {/* Trainer Avatar */}
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-lg">
                        {trainer.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Trainer Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate" title={trainer.name}>
                        {trainer.name}
                      </h3>
                      <p className="text-sm text-gray-600 truncate">
                        {trainer.rank}
                      </p>
                      {trainer.specialization && (
                        <p className="text-xs text-blue-600 font-medium mt-1 truncate">
                          {trainer.specialization}
                        </p>
                      )}
                      {trainer.status && (
                        <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-semibold ${trainer.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                          }`}>
                          {trainer.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No Trainers Assigned</h3>
              <p className="text-gray-500">No trainers have been assigned to this event yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Schedule Information */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-200">
        <div className="flex items-start space-x-3">
          <svg className="w-6 h-6 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Schedule Information</h3>
            <p className="text-sm text-gray-700">
              All assigned trainers are scheduled for the entire event duration
              ({duration} {duration === 1 ? 'day' : 'days'}). Each trainer has individual schedule
              entries created for every day of the event period.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}