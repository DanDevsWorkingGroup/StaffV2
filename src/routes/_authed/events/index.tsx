import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to fetch events
const getEvents = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: true })

  return {
    events: events || []
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
  loader: async () => await getEvents(),
  component: EventsPage,
})

function EventsPage() {
  const { events } = Route.useLoaderData()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

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
  const pastEvents = filteredEvents.filter((e: any) => new Date(e.end_date) < new Date())

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Event Management</h1>
            <p className="text-gray-600">Create and manage training events</p>
          </div>
          <Link
            to="/events/create"
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center space-x-2"
          >
            <span>➕</span>
            <span>Create Event</span>
          </Link>
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
          value={pastEvents.length} 
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
        {pastEvents.length > 0 && (
          <EventSection title="Past Events" events={pastEvents} />
        )}

        {/* No Results */}
        {filteredEvents.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">No Events Found</h3>
            <p className="text-gray-600">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  )
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
function EventSection({ title, events }: { title: string; events: any[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="bg-gray-50 px-6 py-4 border-b">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="divide-y">
        {events.map((event: any) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}

// Event Card Component
function EventCard({ event }: { event: any }) {
  const categoryColor = EVENT_COLORS.find(c => c.name === event.category)
  const startDate = new Date(event.start_date)
  const endDate = new Date(event.end_date)
  
  // Calculate duration
  const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

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
            
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
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