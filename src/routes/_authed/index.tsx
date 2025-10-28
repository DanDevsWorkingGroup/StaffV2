import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'

// Server function to fetch dashboard data
const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  const today = new Date().toISOString().split('T')[0]
  
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

  // Calculate statistics
  const totalCapacity = 50 * 4 // 50 rooms, 4 people each
  const occupancyRate = Math.round((dormitoryAssignments?.length || 0) / totalCapacity * 100)

  return {
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todaySessions?.length || 0,
      physicalTraining: physicalTraining?.length || 0,
      religiousActivities: religiousActivities?.length || 0,
      upcomingEvents: upcomingEvents?.length || 0,
      occupancyRate,
    },
    upcomingEvents: upcomingEvents || [],
    todayActivities: {
      sessions: todaySessions || [],
      physical: physicalTraining || [],
      religious: religiousActivities || [],
    }
  }
})

export const Route = createFileRoute('/_authed/')({  // Changed from '/' to '/_authed/'
  loader: async () => await getDashboardData(),
  component: DashboardPage,
})

function DashboardPage() {
  const { stats, upcomingEvents, todayActivities } = Route.useLoaderData()
  const { user } = Route.useRouteContext()

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded lg shadow-lg p-8 text-white">
        
        <div className="flex items-center space-x-4">
          <div className="text-6xl">🔥</div>
          <div>
            <h1 className="text-4xl font-bold mb-2">ABPM Trainer System</h1>
            <p className="text-blue-100 text-lg">
              Welcome back, {user?.email}! 
            </p>
            <p className="text-blue-200 text-sm mt-1">
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

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard 
          title="Active Trainers" 
          value={stats.activeTrainers} 
          icon="👥" 
          color="bg-blue-500"
          link="/schedule"
        />
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
        <StatCard 
          title="Occupancy" 
          value={`${stats.occupancyRate}%`} 
          icon="🏢" 
          color="bg-indigo-500"
          link="/dormitory"
        />
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

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionButton 
            to="/schedule" 
            icon="📅" 
            label="View Schedule"
            color="bg-blue-500"
          />
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
        </div>
      </div>
    </div>
  )
}

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