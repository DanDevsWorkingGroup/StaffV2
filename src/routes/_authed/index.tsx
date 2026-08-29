import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'

// Server function to fetch dashboard data
const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()

  const today = new Date().toISOString().split('T')[0]

  // FIXED: Get current user and trainer info
  const { data: { user } } = await supabase.auth.getUser()
  let currentTrainer = null
  
  if (user) {
    const { data: trainerData } = await supabase
      .from('trainers')
      .select('*, roles(name)')
      .eq('user_id', user.id)
      .single()
    currentTrainer = trainerData
  }

  // Fetch all necessary data
  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')

  const { data: todaySessions } = await supabase
    .from('training_sessions')
    .select('*')
    .eq('date', today)

  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('*')
    .gte('start_date', today)
    .order('start_date', { ascending: true })
    .limit(5)

  const { data: physicalTraining } = await supabase
    .from('physical_training')
    .select('*')
    .eq('date', today)

  const { data: religiousActivities } = await supabase
    .from('religious_activities')
    .select('*')
    .eq('date', today)

  const { data: dormitoryAssignments } = await supabase
    .from('dormitory_assignments')
    .select('*')

  // FIXED: Role-based filtering logic
  const role = currentTrainer?.roles?.name
  const trainerId = currentTrainer?.id
  const trainerName = currentTrainer?.name

  // Initialize with all data (for ADMIN and COORDINATOR)
  let filteredPhysical = physicalTraining || []
  let filteredReligious = religiousActivities || []
  let filteredEvents = upcomingEvents || []
  
  // Track which stats need filtering vs total
  let ptCountIsFiltered = false
  let raCountIsFiltered = false
  let eventsCountIsFiltered = false

  // Helper function to filter by assignment (in_charge OR participants)
  const filterByAssignment = (items: any[], checkName: boolean = true) => {
    if (!trainerId || !items) return []
    
    return items.filter((item: any) => {
      const isInCharge = checkName && item.in_charge === trainerName
      const isParticipant = Array.isArray(item.participants) && item.participants.includes(trainerId)
      return isInCharge || isParticipant
    })
  }

 // Helper function to filter events by schedules
const filterEventsBySchedules = async (events: any[]) => {
  console.log('🔍 filterEventsBySchedules called:', {
    trainerId,
    trainerName,
    eventsCount: events?.length || 0,
    events: events?.map(e => ({ id: e.id, name: e.name }))
  })
  
  if (!trainerId || !events || events.length === 0) {
    console.warn('⚠️ Early return - missing trainerId or events')
    return []
  }
  
  // Fetch schedules for this trainer (no event_id, use notes instead)
  const { data: trainerSchedules, error } = await supabase
    .from('schedules')
    .select('id, date, notes, status')
    .eq('trainer_id', trainerId)
  
  console.log('📅 Schedule query result:', {
    schedulesCount: trainerSchedules?.length || 0,
    schedules: trainerSchedules?.slice(0, 5), // Show first 5 for debugging
    error: error
  })
  
  if (error) {
    console.error('❌ Error fetching schedules:', error)
    return []
  }
  
  if (!trainerSchedules || trainerSchedules.length === 0) {
    console.warn('⚠️ No schedules found for trainer')
    return []
  }
  
  // Extract event names from notes field
  // Notes format: "Assigned to: Event Name"
  const assignedEventNames = new Set<string>()
  
  trainerSchedules.forEach((schedule: any) => {
    if (schedule.notes && schedule.notes.includes('Assigned to:')) {
      // Extract event name from "Assigned to: Event Name"
      const eventName = schedule.notes.replace('Assigned to:', '').trim()
      if (eventName) {
        assignedEventNames.add(eventName)
      }
    }
  })
  
  console.log('🎯 Assigned Event Names from schedules:', Array.from(assignedEventNames))
  
  // Filter events by matching names
  const filteredEvents = events.filter((event: any) => {
    const isAssigned = assignedEventNames.has(event.name)
    console.log(`  Event ${event.id} (${event.name}): ${isAssigned ? '✅ ASSIGNED' : '❌ NOT ASSIGNED'}`)
    return isAssigned
  })
  
  console.log('✅ Filtered events result:', {
    totalEvents: events.length,
    assignedEvents: filteredEvents.length,
    events: filteredEvents.map(e => ({ id: e.id, name: e.name }))
  })
  
  return filteredEvents
}

  // Apply role-specific filtering
  if (role && trainerId) {
    switch (role) {
      case 'PT COORDINATOR':
        // PT Coordinator sees ALL PT, but filtered Events and RA
        filteredPhysical = physicalTraining || []  // No filtering for PT
        filteredReligious = filterByAssignment(religiousActivities || [])  // Filter RA
        filteredEvents = await filterEventsBySchedules(upcomingEvents || [])  // Filter Events
        
        // Stats: PT shows total, others show filtered
        ptCountIsFiltered = false
        raCountIsFiltered = true
        eventsCountIsFiltered = true
        break

      case 'EVENT COORDINATOR':
        // Event Coordinator sees ALL Events, but filtered PT and RA
        filteredPhysical = filterByAssignment(physicalTraining || [])  // Filter PT
        filteredReligious = filterByAssignment(religiousActivities || [])  // Filter RA
        filteredEvents = upcomingEvents || []  // No filtering for Events
        
        // Stats: Events shows total, others show filtered
        ptCountIsFiltered = true
        raCountIsFiltered = true
        eventsCountIsFiltered = false
        break

      case 'RA COORDINATOR':
        // RA Coordinator sees ALL RA, but filtered PT and Events
        filteredPhysical = filterByAssignment(physicalTraining || [])  // Filter PT
        filteredReligious = religiousActivities || []  // No filtering for RA
        filteredEvents = await filterEventsBySchedules(upcomingEvents || [])  // Filter Events
        
        // Stats: RA shows total, others show filtered
        ptCountIsFiltered = true
        raCountIsFiltered = false
        eventsCountIsFiltered = true
        break

      case 'DORMITORY COORDINATOR':
        // Dormitory Coordinator is filtered for ALL activities
        filteredPhysical = filterByAssignment(physicalTraining || [])
        filteredReligious = filterByAssignment(religiousActivities || [])
        filteredEvents = await filterEventsBySchedules(upcomingEvents || [])
        
        // All stats show filtered counts
        ptCountIsFiltered = true
        raCountIsFiltered = true
        eventsCountIsFiltered = true
        break

      case 'TRAINER':
        // Trainers are filtered for ALL activities
        filteredPhysical = filterByAssignment(physicalTraining || [])
        filteredReligious = filterByAssignment(religiousActivities || [])
        filteredEvents = await filterEventsBySchedules(upcomingEvents || [])
        
        // All stats show filtered counts
        ptCountIsFiltered = true
        raCountIsFiltered = true
        eventsCountIsFiltered = true
        break

      case 'ADMIN':
      case 'COORDINATOR':
        // ADMIN and COORDINATOR see everything (no filtering)
        filteredPhysical = physicalTraining || []
        filteredReligious = religiousActivities || []
        filteredEvents = upcomingEvents || []
        
        // All stats show total counts
        ptCountIsFiltered = false
        raCountIsFiltered = false
        eventsCountIsFiltered = false
        break

      default:
        // Unknown role - apply full filtering for safety
        filteredPhysical = filterByAssignment(physicalTraining || [])
        filteredReligious = filterByAssignment(religiousActivities || [])
        filteredEvents = await filterEventsBySchedules(upcomingEvents || [])
        
        ptCountIsFiltered = true
        raCountIsFiltered = true
        eventsCountIsFiltered = true
        break
    }
  }

  // Calculate statistics with appropriate counts
  const totalCapacity = 50 * 4 // 50 rooms, 4 people each
  const occupancyRate = Math.round((dormitoryAssignments?.length || 0) / totalCapacity * 100)

  return {
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todaySessions?.length || 0,
      // Use filtered count or total based on role
      physicalTraining: ptCountIsFiltered ? filteredPhysical.length : (physicalTraining?.length || 0),
      religiousActivities: raCountIsFiltered ? filteredReligious.length : (religiousActivities?.length || 0),
      upcomingEvents: eventsCountIsFiltered ? filteredEvents.length : (upcomingEvents?.length || 0),
      occupancyRate,
    },
    upcomingEvents: filteredEvents,  // Always return filtered list
    todayActivities: {
      sessions: todaySessions || [],
      physical: filteredPhysical,  // Always return filtered list
      religious: filteredReligious,  // Always return filtered list
    },
    currentTrainer  // For name display
  }
})

export const Route = createFileRoute('/_authed/')({
  loader: async () => await getDashboardData(),
  component: DashboardPage,
})

// ===== HELPER FUNCTIONS FOR RBAC =====

/**
 * Check if user has management access (ADMIN or COORDINATOR)
 * @param role - User's role from context
 * @returns boolean - true if user can access management features
 */
function canAccessManagement(role?: string): boolean {
  return role === 'ADMIN' || role === 'COORDINATOR'
}

/**
 * Get appropriate grid classes based on number of visible stat cards
 * @param role - User's role from context
 * @returns string - Tailwind grid classes
 */
function getStatCardGridClass(role?: string): string {
  // TRAINER sees 4 cards, ADMIN/COORDINATOR see 6 cards
  const isManagement = canAccessManagement(role)
  return isManagement
    ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
    : "grid grid-cols-2 md:grid-cols-4 gap-4"
}

/**
 * Get appropriate grid classes for quick actions based on visible buttons
 * @param role - User's role from context
 * @returns string - Tailwind grid classes
 */
function getQuickActionGridClass(role?: string): string {
  // TRAINER sees 1 button, ADMIN/COORDINATOR see 4 buttons
  const isManagement = canAccessManagement(role)
  return isManagement
    ? "grid grid-cols-2 md:grid-cols-4 gap-4"
    : "grid grid-cols-1 md:grid-cols-2 gap-4"
}

// ===== MAIN COMPONENT =====

function DashboardPage() {
  const { stats, upcomingEvents, todayActivities, currentTrainer } = Route.useLoaderData()
  const { user } = Route.useRouteContext()

  // Check if user has management access
  const isManagement = canAccessManagement(user?.role)

  // FIXED: Get display name - prefer trainer name over email
  const displayName = currentTrainer?.name || user?.email || 'User'

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-5 text-white sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img
            src="/abpm-logo.png"
            alt="ABPM Logo"
            width={607}
            height={411}
            className="h-14 w-auto self-start sm:h-24 lg:h-32"
          />
          <div className="min-w-0">
            <h1 className="text-balance text-2xl font-bold sm:text-3xl lg:text-4xl">ABPM Trainer System</h1>
            <p className="mt-1 text-blue-100 sm:text-lg">
              Welcome back, {displayName}!
            </p>
            <p className="mt-1 text-sm text-blue-200">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats - Role-based rendering */}
      <div className={getStatCardGridClass(user?.role)}>
        {/* Always visible to all roles */}
        <StatCard
          title="Today's Sessions"
          value={stats.todaySessions}
          icon="📅"
          color="bg-green-500"
          link="/schedule"
        />
        <StatCard
          title="Upcoming Events"
          value={stats.upcomingEvents}
          icon="📋"
          color="bg-purple-500"
          link="/events"
        />
        <StatCard
          title="PT Today"
          value={stats.physicalTraining}
          icon="💪"
          color="bg-orange-500"
          link="/physical-training"
        />
        <StatCard
          title="Religious"
          value={stats.religiousActivities}
          icon="📖"
          color="bg-teal-500"
          link="/religious-activity"
        />

        {/* Only visible to ADMIN and COORDINATOR */}
        {isManagement && (
          <>
            <StatCard
              title="Active Trainers"
              value={stats.activeTrainers}
              icon="👥"
              color="bg-blue-500"
              link="/schedule"
            />
            <StatCard
              title="Occupancy"
              value={`${stats.occupancyRate}%`}
              icon="🏢"
              color="bg-indigo-500"
              link="/dormitory"
            />
          </>
        )}
      </div>

      {/* Today's Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Religious Activities */}
        <div className="bg-white rounded-lg shadow">
          <div className="bg-teal-50 px-6 py-4 border-b">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
              <span>📖</span>
              <span>Today's Religious Activities</span>
            </h2>
          </div>
          <div className="p-6">
            {todayActivities.religious.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No activities scheduled for today</p>
            ) : (
              <div className="space-y-3">
                {todayActivities.religious.map((activity: any) => (
                  <div key={activity.id} className="bg-teal-50 p-3 rounded-lg border-l-4 border-teal-500">
                    <p className="font-semibold text-gray-900">{activity.activity}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Leader: {activity.in_charge}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/religious-activity"
              className="block mt-4 text-center text-teal-600 hover:text-teal-700 font-semibold"
            >
              View All →
            </Link>
          </div>
        </div>

        {/* Physical Training */}
        <div className="bg-white rounded-lg shadow">
          <div className="bg-orange-50 px-6 py-4 border-b">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
              <span>💪</span>
              <span>Today's Physical Training</span>
            </h2>
          </div>
          <div className="p-6">
            {todayActivities.physical.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No training scheduled for today</p>
            ) : (
              <div className="space-y-3">
                {todayActivities.physical.map((training: any) => (
                  <div key={training.id} className="bg-orange-50 p-3 rounded-lg border-l-4 border-orange-500">
                    <p className="font-semibold text-gray-900">{training.training_type}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Time: {training.time_slot}
                    </p>
                    <p className="text-sm text-gray-600">
                      In Charge: {training.in_charge}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/physical-training"
              className="block mt-4 text-center text-orange-600 hover:text-orange-700 font-semibold"
            >
              View All →
            </Link>
          </div>
        </div>
      </div>

      {/* Upcoming Events */}
      <div className="bg-white rounded-lg shadow">
        <div className="bg-purple-50 px-6 py-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
            <span>📋</span>
            <span>Upcoming Events</span>
          </h2>
        </div>
        <div className="p-6">
          {upcomingEvents.length === 0 ? (
            <p className="text-gray-600 text-center py-4">No upcoming events</p>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((event: any) => {
                const startDate = new Date(event.start_date)
                const endDate = new Date(event.end_date)
                const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

                return (
                  <Link
                    key={event.id}
                    to="/events/$id"
                    params={{ id: event.id }}
                    className="block bg-purple-50 p-4 rounded-lg border-l-4 border-purple-500 hover:bg-purple-100 transition"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-gray-900">{event.name}</p>
                        <p className="text-sm text-gray-600 mt-1">{event.category}</p>
                        <p className="text-sm text-gray-600 mt-1">
                          📅 {startDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric'
                          })}
                          {duration > 1 && ` - ${endDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric'
                          })}`}
                        </p>
                      </div>
                      <span className="text-gray-400">→</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          <Link
            to="/events"
            className="block mt-4 text-center text-purple-600 hover:text-purple-700 font-semibold"
          >
            View All Events →
          </Link>
        </div>
      </div>

      {/* Quick Actions - Role-based rendering */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className={getQuickActionGridClass(user?.role)}>
          {/* Always visible to all roles */}
          <QuickActionButton
            to="/schedule"
            icon="📅"
            label="View Schedule"
            color="bg-blue-500"
          />

          {/* Only visible to ADMIN and COORDINATOR */}
          {isManagement && (
            <>
              <QuickActionButton
                to="/events/create"
                icon="➕"
                label="Create Event"
                color="bg-purple-500"
              />
              <QuickActionButton
                to="/trainer-overview"
                icon="👥"
                label="Trainer Stats"
                color="bg-green-500"
              />
              <QuickActionButton
                to="/dormitory"
                icon="🏢"
                label="Dormitory"
                color="bg-indigo-500"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== SUB-COMPONENTS =====

// Stat Card Component
function StatCard({
  title,
  value,
  icon,
  color,
  link
}: {
  title: string
  value: string | number
  icon: string
  color: string
  link: string
}) {
  return (
    <Link to={link} className="bg-white rounded-lg shadow hover:shadow-lg transition p-4">
      <div className="flex flex-col items-center">
        <div className={`${color} w-12 h-12 rounded-full flex items-center justify-center text-2xl mb-2`}>
          {icon}
        </div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-600 text-center mt-1">{title}</p>
      </div>
    </Link>
  )
}

// Quick Action Button Component
function QuickActionButton({
  to,
  icon,
  label,
  color
}: {
  to: string
  icon: string
  label: string
  color: string
}) {
  return (
    <Link
      to={to}
      className={`${color} hover:opacity-90 text-white rounded-lg p-4 flex flex-col items-center justify-center space-y-2 transition`}
    >
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-semibold text-center">{label}</span>
    </Link>
  )
}