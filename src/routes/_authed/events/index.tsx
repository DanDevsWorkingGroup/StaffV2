import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { getCurrentUserRole } from '~/middleware/rbac'
import { useState } from 'react'

// Server function to fetch events with trainer counts
const getEventsWithTrainers = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  const user = await getCurrentUserRole()

  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: true })

  let visibleEvents = events || []

  // If user is TRAINER, only show events where they have a schedule
  if (user?.role === 'TRAINER') {
    const { data: mySchedules } = await supabase
      .from('schedules')
      .select('date')
      .eq('trainer_id', user.trainerId)
      .eq('status', 'scheduled')

    const scheduleDates = new Set(mySchedules?.map(s => s.date))

    visibleEvents = visibleEvents.filter(event => {
      let curr = new Date(event.start_date)
      const end = new Date(event.end_date)

      while (curr <= end) {
        const dateStr = curr.toISOString().split('T')[0]
        if (scheduleDates.has(dateStr)) return true
        curr.setDate(curr.getDate() + 1)
      }
      return false
    })
  }

  // For each event, get the count of unique trainers assigned
  const eventsWithTrainers = await Promise.all(
    visibleEvents.map(async (event: any) => {
      const { data: schedules } = await supabase
        .from('schedules')
        .select(`
          trainer_id,
          trainers (
            id,
            name,
            rank
          )
        `)
        .gte('date', event.start_date)
        .lte('date', event.end_date)
        .eq('status', 'scheduled')

      // Get unique trainers
      const uniqueTrainerIds = new Set()
      const assignedTrainers = schedules
        ?.filter((schedule: any) => {
          if (!uniqueTrainerIds.has(schedule.trainer_id)) {
            uniqueTrainerIds.add(schedule.trainer_id)
            return true
          }
          return false
        })
        .map((schedule: any) => schedule.trainers)
        .filter(Boolean) || []

      return {
        ...event,
        trainer_count: assignedTrainers.length,
        trainer_preview: assignedTrainers.slice(0, 3) // First 3 trainers for preview
      }
    })
  )

  return {
    events: eventsWithTrainers
  }
})

// Event color categories
const EVENT_COLORS = [
  { name: 'Physical Training', color: '#3b82f6', bg: 'bg-blue-500' },
  { name: 'Safety Training', color: '#8b5cf6', bg: 'bg-purple-500' },
  { name: 'Emergency Response', color: '#ef4444', bg: 'bg-red-500' },
  { name: 'Equipment Inspection', color: '#f59e0b', bg: 'bg-orange-500' },
  { name: 'Leadership Training', color: '#eab308', bg: 'bg-yellow-500' },
  { name: 'Team Building', color: '#10b981', bg: 'bg-green-500' },
  { name: 'Religious Activity', color: '#14b8a6', bg: 'bg-teal-500' },
  { name: 'Community Service', color: '#06b6d4', bg: 'bg-cyan-500' },
  { name: 'Routine Maintenance', color: '#92400e', bg: 'bg-amber-800' },
  { name: 'Special Event', color: '#ec4899', bg: 'bg-pink-500' },
  { name: 'Development Program', color: '#6366f1', bg: 'bg-indigo-500' },
  { name: 'Collaboration Activity', color: '#a855f7', bg: 'bg-violet-500' },
]

export const Route = createFileRoute('/_authed/events/')({
  loader: async () => await getEventsWithTrainers(),
  component: EventsPage,
})

function EventsPage() {
  const { events } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedPastMonth, setSelectedPastMonth] = useState<string>('all')


  // RBAC: Check if user can create events
  // Only ADMIN, COORDINATOR, and EVENT COORDINATOR can create events
  const canCreateEvent = ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'].includes(user?.role || '')

  // Filter events
  const filteredEvents = events.filter((event: any) => {
    const matchesSearch = event.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.category.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || event.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Group events by status
  const upcomingEvents = filteredEvents.filter((e: any) => new Date(e.start_date) > new Date())
  const ongoingEvents = filteredEvents.filter((e: any) => {
    const start = new Date(e.start_date)
    const end = new Date(e.end_date)
    const now = new Date()
    return start <= now && end >= now
  })

  const pastEventsAll = filteredEvents
  .filter((e: any) => new Date(e.end_date) < new Date())
  .sort((a: any, b: any) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())

const pastEventMonths = Array.from(
  new Set(pastEventsAll.map((e: any) => {
    const d = new Date(e.end_date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }))
).sort((a, b) => b.localeCompare(a)) // most recent month first

const pastEvents = selectedPastMonth === 'all'
  ? pastEventsAll
  : pastEventsAll.filter((e: any) => {
      const d = new Date(e.end_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return key === selectedPastMonth
    })


  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Event Management</h1>
            <p className="text-gray-600">
              {canCreateEvent 
                ? 'Create and manage training events' 
                : 'View training events and assigned trainers'}
            </p>
          </div>
          {/* RBAC: Only show Create Event button to ADMIN, COORDINATOR, and EVENT COORDINATOR */}
          {canCreateEvent && (
            <Link
              to="/events/create"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center space-x-2 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create Event</span>
            </Link>
          )}
        </div>

      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search Bar */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Categories</option>
            {EVENT_COLORS.map(cat => (
              <option key={cat.name} value={cat.name}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Event Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Upcoming Events"
          value={upcomingEvents.length}
          icon="📅"
          color="bg-blue-500"
        />
        <StatCard
          title="Ongoing Events"
          value={ongoingEvents.length}
          icon="🔄"
          color="bg-green-500"
        />
        <StatCard
          title="Past Events"
          value={pastEventsAll.length}
          icon="✅"
          color="bg-gray-500"
        />
      </div>

      {/* Events List */}
      <div className="space-y-4">
        {/* Ongoing Events */}
        {ongoingEvents.length > 0 && (
          <EventSection title="Ongoing Events" events={ongoingEvents} />
        )}

        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <EventSection title="Upcoming Events" events={upcomingEvents} />
        )}

        {/* Past Events */}
{pastEventsAll.length > 0 && (
  <EventSection
    title="Past Events"
    events={pastEvents}
    filterControl={
      <select
        value={selectedPastMonth}
        onChange={(e) => setSelectedPastMonth(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All Months</option>
        {pastEventMonths.map((key) => (
          <option key={key} value={key}>{formatMonthLabel(key)}</option>
        ))}
      </select>
    }
  />
)}

        {/* No Results */}
        {filteredEvents.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🔭</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">No Events Found</h3>
            <p className="text-gray-600">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Stat Card Component
function StatCard({ title, value, icon, color }: {
  title: string;
  value: number;
  icon: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <div className={`${color} w-16 h-16 rounded-full flex items-center justify-center text-3xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// Event Section Component
function EventSection({ title, events, filterControl }: { title: string; events: any[]; filterControl?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="bg-gray-50 px-6 py-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {filterControl}
      </div>
      {events.length > 0 ? (
        <div className="divide-y">
          {events.map((event: any) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="p-6 text-center text-gray-500 text-sm">No events found for this month</div>
      )}
    </div>
  )
}

// Event Card Component
function EventCard({ event }: { event: any }) {
  const categoryColor = EVENT_COLORS.find(c => c.name === event.category)
  const startDate = new Date(event.start_date)
  const endDate = new Date(event.end_date)

  // Calculate duration
  const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

  return (
    <Link
      to={`/events/$id`}
      params={{ id: event.id }}
      className="block hover:bg-gray-50 transition"
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              {/* Color indicator */}
              <div
                className={`w-4 h-4 rounded-full ${categoryColor?.bg || 'bg-gray-400'}`}
              />
              <h3 className="text-lg font-semibold text-gray-900">{event.name}</h3>
            </div>

            <p className="text-sm text-gray-600 mb-3">{event.category}</p>

            <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
              <div className="flex items-center space-x-2">
                <span>📅</span>
                <span>
                  {startDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                  {duration > 1 && (
                    <> - {endDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}</>
                  )}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <span>⏱️</span>
                <span>{duration} {duration === 1 ? 'day' : 'days'}</span>
              </div>
            </div>

            {/* Trainer Preview Section */}
            {event.trainer_count > 0 && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-blue-900">
                      {event.trainer_count} {event.trainer_count === 1 ? 'Trainer' : 'Trainers'} Assigned
                    </span>
                  </div>

                  {/* Trainer avatars preview */}
                  <div className="flex -space-x-2">
                    {event.trainer_preview?.slice(0, 3).map((trainer: any, index: number) => (
                      <div
                        key={trainer.id}
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 border-2 border-white flex items-center justify-center"
                        title={trainer.name}
                      >
                        <span className="text-white text-xs font-semibold">
                          {trainer.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    ))}
                    {event.trainer_count > 3 && (
                      <div className="w-8 h-8 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center">
                        <span className="text-gray-700 text-xs font-semibold">
                          +{event.trainer_count - 3}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Trainer names preview */}
                {event.trainer_preview?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-blue-700">
                      {event.trainer_preview.slice(0, 2).map((t: any) => t.name).join(', ')}
                      {event.trainer_count > 2 && ` and ${event.trainer_count - 2} more`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* No trainers assigned indicator */}
            {event.trainer_count === 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span className="text-sm text-gray-500">No trainers assigned yet</span>
                </div>
              </div>
            )}

            {event.description && (
              <p className="mt-3 text-gray-700 line-clamp-2">{event.description}</p>
            )}
          </div>

          {/* Arrow indicator */}
          <div className="ml-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  )
}