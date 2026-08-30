import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { getCurrentUserRole, resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState, useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MonthCalendar, type CalItem } from '~/components/mobile'

// Server functions
const getReligiousActivityData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()

  const { data: activities } = await supabase
    .from('religious_activities')
    .select('*')
    .order('date', { ascending: true })

  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')

  // Get current user info
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

  // Calculate stats
  const today = new Date().toISOString().split('T')[0]
  const todayActivities = activities?.filter(a => a.date === today) || []

  // Get this week's activities
  const startOfWeek = new Date()
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)
  startOfWeek.setHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  endOfWeek.setHours(23, 59, 59, 999)

  const thisWeekActivities = activities?.filter(a => {
    const activityDate = new Date(a.date)
    return activityDate >= startOfWeek && activityDate <= endOfWeek
  }) || []

  // Filter for TRAINER role
  const currentUser = await getCurrentUserRole()
  let visibleActivities = activities || []

  if (currentUser?.role === 'TRAINER') {
    visibleActivities = visibleActivities.filter((activity: any) =>
      activity.in_charge === currentUser.name ||
      activity.participants.includes(currentUser.trainerId)
    )
  }

  // Recalculate stats for trainer view
  if (currentUser?.role === 'TRAINER') {
    const todayActivitiesFiltered = visibleActivities.filter(a => a.date === today)
    const thisWeekActivitiesFiltered = visibleActivities.filter(a => {
      const activityDate = new Date(a.date)
      return activityDate >= startOfWeek && activityDate <= endOfWeek
    })

    return {
      activities: visibleActivities,
      trainers: trainers || [],
      currentTrainer,
      stats: {
        activeParticipants: trainers?.length || 0,
        todayActivities: todayActivitiesFiltered.length,
        thisWeekActivities: thisWeekActivitiesFiltered.length,
      }
    }
  }

  return {
    activities: activities || [],
    trainers: trainers || [],
    currentTrainer,
    stats: {
      activeParticipants: trainers?.length || 0,
      todayActivities: todayActivities.length,
      thisWeekActivities: thisWeekActivities.length,
    }
  }
})

const createActivity = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    date: string
    activity: string
    in_charge: string
    participants: number[]
  }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'RA COORDINATOR'])

    const supabase = getSupabaseServerClient()

    const { error } = await supabase
      .from('religious_activities')
      .insert([data])

    if (error) {
      return { error: error.message }
    }

    return { success: true }
  })

const ACTIVITY_TYPES = [
  'Fajr Prayer',
  'Dhuhr Prayer',
  'Asr Prayer',
  'Maghrib Prayer',
  'Isha Prayer',
  'Friday Prayer (Jummah)',
  'Islamic Studies',
  'Quran Recitation',
  'Religious Lecture',
  'Community Prayer',
  'Tafsir Session',
  'Dua & Dhikr',
]

export const Route = createFileRoute('/_authed/religious-activity/')({
  loader: async () => await getReligiousActivityData(),
  component: ReligiousActivityPage,
})

function ReligiousActivityPage() {
  const { activities, trainers, currentTrainer, stats } = Route.useLoaderData()
  
  // RBAC: Check if user can create religious activities
  const canCreateRA = currentTrainer?.roles?.name && 
    ['ADMIN', 'COORDINATOR', 'RA COORDINATOR'].includes(currentTrainer.roles.name)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [view, setView] = useState<'week' | 'month' | 'participant-schedule' | 'my-schedule'>('month')
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all')

  // Filter states for Active Participants section
  const [participantSearchQuery, setParticipantSearchQuery] = useState('')
  const [participantFilterRank, setParticipantFilterRank] = useState('')
  const [participantFilterSpecialization, setParticipantFilterSpecialization] = useState('')
  const [participantFilterDepartment, setParticipantFilterDepartment] = useState('')

  // Filter states for Participant Schedule Grid
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('')
  const [scheduleFilterRank, setScheduleFilterRank] = useState('')
  const [scheduleFilterSpecialization, setScheduleFilterSpecialization] = useState('')
  const [scheduleFilterDepartment, setScheduleFilterDepartment] = useState('')

  // Filtered participants for Active Participants section
  const filteredActiveParticipants = trainers.filter((t: any) => {
    const searchLower = participantSearchQuery.toLowerCase()
    const matchesSearch = (
      t.name.toLowerCase().includes(searchLower) ||
      (t.rank || '').toLowerCase().includes(searchLower) ||
      (t.specialization || '').toLowerCase().includes(searchLower)
    )
    const matchesRank = !participantFilterRank || t.rank === participantFilterRank
    const matchesSpecialization = !participantFilterSpecialization || t.specialization === participantFilterSpecialization
    const matchesDepartment = !participantFilterDepartment || t.department === participantFilterDepartment
    
    return matchesSearch && matchesRank && matchesSpecialization && matchesDepartment
  })

  // Filtered participants for Participant Schedule Grid
  const filteredScheduleParticipants = trainers.filter((t: any) => {
    const searchLower = scheduleSearchQuery.toLowerCase()
    const matchesSearch = (
      t.name.toLowerCase().includes(searchLower) ||
      (t.rank || '').toLowerCase().includes(searchLower) ||
      (t.specialization || '').toLowerCase().includes(searchLower)
    )
    const matchesRank = !scheduleFilterRank || t.rank === scheduleFilterRank
    const matchesSpecialization = !scheduleFilterSpecialization || t.specialization === scheduleFilterSpecialization
    const matchesDepartment = !scheduleFilterDepartment || t.department === scheduleFilterDepartment
    
    return matchesSearch && matchesRank && matchesSpecialization && matchesDepartment
  })

  // Get unique values for filters
  const uniqueRanks = Array.from(new Set(trainers.map((t: any) => t.rank).filter(Boolean))).sort()
  const uniqueSpecializations = Array.from(new Set(trainers.map((t: any) => t.specialization).filter(Boolean))).sort()
  const uniqueDepartments = Array.from(new Set(trainers.map((t: any) => t.department).filter(Boolean))).sort()

  // Get activities for a specific date
  const getActivitiesForDate = (day: number, month?: number, year?: number) => {
    const m = month ?? currentDate.getMonth()
    const y = year ?? currentDate.getFullYear()
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return activities.filter((a: any) => a.date === dateStr)
  }

  // Get today's activities
  const getTodayActivities = () => {
    const today = new Date()
    return getActivitiesForDate(today.getDate(), today.getMonth(), today.getFullYear())
  }

  // Get this week's activities
  const getWeekActivities = () => {
    const startOfWeek = new Date(currentDate)
    const day = startOfWeek.getDay()
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
    startOfWeek.setDate(diff)

    const activitiesArray: any[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek)
      date.setDate(startOfWeek.getDate() + i)
      const dayActivities = getActivitiesForDate(date.getDate(), date.getMonth(), date.getFullYear())
      activitiesArray.push(...dayActivities.map(a => ({ ...a, displayDate: date })))
    }
    return activitiesArray
  }

  // Get activities for selected participant
  const getParticipantActivities = () => {
    if (selectedParticipant === 'all') {
      return activities
    }
    return activities.filter((a: any) =>
      a.in_charge === selectedParticipant || a.participants.some((p: number) => {
        const trainer = trainers.find((tr: any) => tr.id === p)
        return trainer?.name === selectedParticipant
      })
    )
  }

  const handleDateClick = (day: number) => {
  // RBAC Protection: Only authorized roles can create activities
  if (!canCreateRA) {
    alert('Unauthorized: Only RA Coordinators and Admins can create religious activities')
    return
  }
  
  const selected = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
  setSelectedDate(selected)
  setShowModal(true)
}

  // Get days in current month
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDay = firstDay.getDay()

    const days = []

    for (let i = 0; i < startDay; i++) {
      days.push(null)
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }

    return days
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Religious Activities Schedule</h1>
        <p className="text-gray-600">Schedule spiritual guidance and community building activities</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Today's Activities"
          value={stats.todayActivities}
          icon="📖"
          color="bg-teal-500"
        />
        <StatCard
          title="This Week"
          value={stats.thisWeekActivities}
          icon="📅"
          color="bg-green-500"
        />
        <StatCard
          title="Active Participants"
          value={stats.activeParticipants}
          icon="👥"
          color="bg-purple-500"
        />
      </div>

      {/* Calendar Controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          {/* Navigation */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                if (view === 'week' || view === 'participant-schedule' || view === 'my-schedule') {
                  newDate.setDate(currentDate.getDate() - 7)
                } else {
                  newDate.setMonth(currentDate.getMonth() - 1)
                }
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              ◀ Previous
            </button>

            <h2 className="text-2xl font-bold text-gray-900">
              {view === 'week' || view === 'participant-schedule' || view === 'my-schedule'
                ? `Week of ${currentDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}`
                : currentDate.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long'
                })
              }
            </h2>

            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                if (view === 'week' || view === 'participant-schedule' || view === 'my-schedule') {
                  newDate.setDate(currentDate.getDate() + 7)
                } else {
                  newDate.setMonth(currentDate.getMonth() + 1)
                }
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              Next ▶
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setView('week')}
              className={`px-4 py-2 rounded transition ${view === 'week' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded transition ${view === 'month' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
            >
              Month
            </button>
            {/* Show Participant Schedule only for authorized roles */}
{canCreateRA && (
  <button
    onClick={() => setView('participant-schedule')}
    className={`px-4 py-2 rounded transition ${view === 'participant-schedule' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
      }`}
  >
    Participant Schedule
  </button>
)}
            {/* Show My Schedule tab only if user is a trainer */}
            {currentTrainer && (
              <button
                onClick={() => setView('my-schedule')}
                className={`px-4 py-2 rounded ${view === 'my-schedule' ? 'bg-teal-600 text-white' : 'bg-gray-200'
                  }`}
              >
                My Schedule
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Conditional View Rendering */}
      {view === 'month' && (
        <MonthView
          getDaysInMonth={getDaysInMonth}
          getActivitiesForDate={getActivitiesForDate}
          handleDateClick={handleDateClick}
          currentDate={currentDate}
        />
      )}

      {view === 'week' && (
        <WeekView
          activities={getWeekActivities()}
          currentDate={currentDate}
          trainers={trainers}
        />
      )}

      {view === 'my-schedule' && (
        <MyScheduleView
          currentTrainer={currentTrainer}
          activities={activities}
          currentDate={currentDate}
        />
      )}

      {view === 'participant-schedule' && canCreateRA && (
  <>
          {/* Filters for Participant Schedule */}
          <div className="bg-white rounded-lg shadow">
            <div className="bg-gray-50 p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900 mb-4">🔍 Filter Participants</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Search by Name
                  </label>
                  <input
                    type="text"
                    placeholder="Search participants..."
                    value={scheduleSearchQuery}
                    onChange={(e) => setScheduleSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
                  />
                </div>

                {/* Rank Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Filter by Rank
                  </label>
                  <select
                    value={scheduleFilterRank}
                    onChange={(e) => setScheduleFilterRank(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
                  >
                    <option value="">All Ranks</option>
                    {uniqueRanks.map((rank: any) => (
                      <option key={rank} value={rank}>{rank}</option>
                    ))}
                  </select>
                </div>

                {/* Specialization Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Filter by Specialization
                  </label>
                  <select
                    value={scheduleFilterSpecialization}
                    onChange={(e) => setScheduleFilterSpecialization(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
                  >
                    <option value="">All Specializations</option>
                    {uniqueSpecializations.map((spec: any) => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>

                {/* Department Filter */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Filter by Department
                  </label>
                  <select
                    value={scheduleFilterDepartment}
                    onChange={(e) => setScheduleFilterDepartment(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
                  >
                    <option value="">All Departments</option>
                    {uniqueDepartments.map((dept: any) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Active Filters Summary */}
              {(scheduleSearchQuery || scheduleFilterRank || scheduleFilterSpecialization || scheduleFilterDepartment) && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
                  {scheduleSearchQuery && (
                    <span className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm">
                      Search: "{scheduleSearchQuery}"
                      <button onClick={() => setScheduleSearchQuery('')} className="ml-2">✕</button>
                    </span>
                  )}
                  {scheduleFilterRank && (
                    <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                      Rank: {scheduleFilterRank}
                      <button onClick={() => setScheduleFilterRank('')} className="ml-2">✕</button>
                    </span>
                  )}
                  {scheduleFilterSpecialization && (
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                      Spec: {scheduleFilterSpecialization}
                      <button onClick={() => setScheduleFilterSpecialization('')} className="ml-2">✕</button>
                    </span>
                  )}
                  {scheduleFilterDepartment && (
                    <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                      Dept: {scheduleFilterDepartment}
                      <button onClick={() => setScheduleFilterDepartment('')} className="ml-2">✕</button>
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setScheduleSearchQuery('')
                      setScheduleFilterRank('')
                      setScheduleFilterSpecialization('')
                      setScheduleFilterDepartment('')
                    }}
                    className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold hover:bg-red-200"
                  >
                    Clear All
                  </button>
                </div>
              )}

              {/* Results Count */}
              <div className="mt-4 text-sm text-gray-600">
                Showing <span className="font-bold text-gray-900">{filteredScheduleParticipants.length}</span> of <span className="font-bold text-gray-900">{trainers.length}</span> participants
              </div>
            </div>
          </div>

          <ParticipantScheduleView
            trainers={filteredScheduleParticipants}
            activities={getParticipantActivities()}
            selectedParticipant={selectedParticipant}
            setSelectedParticipant={setSelectedParticipant}
            currentDate={currentDate}
          />
        </>
      )}

      {/* Always Show Activity List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">
          {view === 'week' ? 'This Week\'s Religious Activities' :
            view === 'participant-schedule' || view === 'my-schedule' ? 'Participant\'s Activities' :
              'Today\'s Religious Activities'}
        </h3>

        {(() => {
          const displayActivities = view === 'week' ? getWeekActivities() :
            view === 'participant-schedule' ? getParticipantActivities() :
              view === 'my-schedule' && currentTrainer ? activities.filter((a: any) =>
                a.in_charge === currentTrainer.name || a.participants.includes(currentTrainer.id)
              ) :
              getTodayActivities()

          if (displayActivities.length === 0) {
            return <p className="text-gray-600">No activities scheduled</p>
          }

          return (
            <div className="space-y-3">
              {displayActivities.map((activity: any) => (
                <Link
                  key={activity.id}
                  to="/religious-activity/$id"
                  params={{ id: activity.id.toString() }}
                  className="block border-l-4 border-teal-500 bg-teal-50 p-4 rounded hover:shadow-lg hover:bg-teal-100 transition-all cursor-pointer"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 text-lg">{activity.activity}</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        <strong>Date:</strong> {(() => {
                          // Use displayDate if available (from week view), otherwise use activity.date
                          if (activity.displayDate) {
                            return activity.displayDate.toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          } else if (activity.date) {
                            // Parse the date string (YYYY-MM-DD) and format it
                            const [year, month, day] = activity.date.split('-')
                            const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                            return dateObj.toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          }
                          return 'Date not available'
                        })()}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        <strong>Leader/Imam:</strong> {activity.in_charge}
                      </p>
                      <p className="text-sm text-gray-600">
                        <strong>Participants:</strong> {activity.participants.length} participant(s)
                      </p>
                    </div>
                    <div className="text-xs bg-teal-200 text-teal-800 px-3 py-1 rounded-full">
                      🕌 Religious
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Active Participants Section with Filtering */}
      <div className="bg-white rounded-lg shadow">
        {/* Filter Section */}
        <div className="p-6 border-b bg-gray-50">
          <h3 className="text-xl font-semibold mb-4">🔍 Filter Active Participants</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Search by Name
              </label>
              <input
                type="text"
                placeholder="Search participants..."
                value={participantSearchQuery}
                onChange={(e) => setParticipantSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
              />
            </div>

            {/* Rank Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filter by Rank
              </label>
              <select
                value={participantFilterRank}
                onChange={(e) => setParticipantFilterRank(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
              >
                <option value="">All Ranks</option>
                {uniqueRanks.map((rank: any) => (
                  <option key={rank} value={rank}>{rank}</option>
                ))}
              </select>
            </div>

            {/* Specialization Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filter by Specialization
              </label>
              <select
                value={participantFilterSpecialization}
                onChange={(e) => setParticipantFilterSpecialization(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
              >
                <option value="">All Specializations</option>
                {uniqueSpecializations.map((spec: any) => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </div>

            {/* Department Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filter by Department
              </label>
              <select
                value={participantFilterDepartment}
                onChange={(e) => setParticipantFilterDepartment(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
              >
                <option value="">All Departments</option>
                {uniqueDepartments.map((dept: any) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Filters Summary */}
          {(participantSearchQuery || participantFilterRank || participantFilterSpecialization || participantFilterDepartment) && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
              {participantSearchQuery && (
                <span className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm">
                  Search: "{participantSearchQuery}"
                  <button onClick={() => setParticipantSearchQuery('')} className="ml-2">✕</button>
                </span>
              )}
              {participantFilterRank && (
                <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                  Rank: {participantFilterRank}
                  <button onClick={() => setParticipantFilterRank('')} className="ml-2">✕</button>
                </span>
              )}
              {participantFilterSpecialization && (
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  Spec: {participantFilterSpecialization}
                  <button onClick={() => setParticipantFilterSpecialization('')} className="ml-2">✕</button>
                </span>
              )}
              {participantFilterDepartment && (
                <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                  Dept: {participantFilterDepartment}
                  <button onClick={() => setParticipantFilterDepartment('')} className="ml-2">✕</button>
                </span>
              )}
              <button
                onClick={() => {
                  setParticipantSearchQuery('')
                  setParticipantFilterRank('')
                  setParticipantFilterSpecialization('')
                  setParticipantFilterDepartment('')
                }}
                className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold hover:bg-red-200"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Results Count */}
          <div className="mt-4 text-sm text-gray-600">
            Showing <span className="font-bold text-gray-900">{filteredActiveParticipants.length}</span> of <span className="font-bold text-gray-900">{trainers.length}</span> participants
          </div>
        </div>

        {/* Participants Grid */}
        <div className="p-6">
          {filteredActiveParticipants.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg font-semibold">No participants found</p>
              <p className="text-sm mt-2">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredActiveParticipants.map((trainer: any) => {
                const participantActivities = activities.filter((a: any) =>
                  a.in_charge === trainer.name || a.participants.includes(trainer.id)
                )

                return (
                  <div
                    key={trainer.id}
                    className="p-4 rounded-lg border-2 transition border-gray-200 hover:border-teal-300"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="bg-teal-100 text-teal-800 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold">
                        {trainer.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{trainer.name}</div>
                        <div className="text-sm text-gray-600">{trainer.rank}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {participantActivities.length} activity(s)
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Assignment Modal */}
      {showModal && selectedDate && (
        <ActivityModal
          date={selectedDate}
          trainers={trainers}
          onClose={() => setShowModal(false)}
          onSubmit={createActivity}
        />
      )}
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
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`${color} text-white p-4 rounded-lg text-2xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// My Schedule View Component
function MyScheduleView({
  currentTrainer,
  activities,
  currentDate
}: {
  currentTrainer: any
  activities: any[]
  currentDate: Date
}) {
  if (!currentTrainer) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
        <p className="text-lg font-semibold">Unable to load your schedule</p>
        <p className="text-sm mt-2">Please ensure you are logged in as a participant</p>
      </div>
    )
  }

  // Filter activities for current trainer
  const myActivities = activities.filter((a: any) =>
    a.in_charge === currentTrainer.name || a.participants.includes(currentTrainer.id)
  )

  // Get week dates
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="bg-teal-50 border-b p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold text-2xl">
            {currentTrainer.name.charAt(0)}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">My Schedule</h2>
            <p className="text-gray-600">{currentTrainer.name} - {currentTrainer.rank}</p>
            {currentTrainer.specialization && (
              <p className="text-sm text-gray-500">{currentTrainer.specialization}</p>
            )}
          </div>
        </div>
      </div>

      {/* Week Grid */}
      <div className="p-6">
        <div className="grid grid-cols-7 gap-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, idx) => {
            const date = weekDates[idx]
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
            const dayActivities = myActivities.filter((a: any) => a.date === dateStr)
            const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
          const isToday = dateStr === todayStr
            const isFriday = date.getDay() === 5

            return (
              <div key={dayName} className="text-center">
                <div className={`font-semibold ${isFriday ? 'text-green-600' : 'text-gray-700'}`}>
                  {dayName}
                  {isFriday && ' 🕌'}
                </div>
                <div className={`text-2xl font-bold mt-2 ${isToday ? 'text-teal-600' : isFriday ? 'text-green-600' : 'text-gray-900'}`}>
                  {date.getDate()}
                </div>
                <div className="mt-4 space-y-2">
                  {dayActivities.map((activity: any) => (
                    <div
                      key={activity.id}
                      className={`text-xs p-2 rounded border-l-4 ${
                        activity.activity.includes('Prayer') || activity.activity.includes('Jummah')
                          ? 'bg-green-100 text-green-800 border-green-500'
                          : 'bg-teal-100 text-teal-800 border-teal-500'
                      }`}
                    >
                      <div className="font-semibold truncate">{activity.activity}</div>
                      {activity.in_charge === currentTrainer.name && (
                        <div className="text-xs mt-1">👤 Leader</div>
                      )}
                    </div>
                  ))}
                  {dayActivities.length === 0 && (
                    <div className="text-xs text-gray-400 italic">No activities</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Month View Component
function MonthView({
  getActivitiesForDate,
  handleDateClick,
  currentDate
}: {
  getDaysInMonth: () => (number | null)[]
  getActivitiesForDate: (day: number) => any[]
  handleDateClick: (day: number) => void
  currentDate: Date
}) {
  const { user } = Route.useRouteContext()
  const readOnly = user?.role === 'TRAINER'

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <MonthCalendar
        monthDate={currentDate}
        readOnly={readOnly}
        accentClass="text-teal-600"
        todayRingClass="border-teal-600 bg-teal-50"
        onDayClick={readOnly ? undefined : handleDateClick}
        getItems={(day) =>
          getActivitiesForDate(day).map((a: any): CalItem => {
            const prayerish = a.activity.includes('Prayer') || a.activity.includes('Jummah')
            return {
              key: a.id,
              label: `${prayerish ? '🕌' : '📖'} ${a.activity}`,
              color: prayerish ? '#16a34a' : '#0d9488',
              onClick: readOnly ? undefined : () => handleDateClick(day),
            }
          })
        }
      />
    </div>
  )
}

// Week View Component
function WeekView({
  activities,
  currentDate,
  trainers
}: {
  activities: any[]
  currentDate: Date
  trainers: any[]
}) {
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="grid grid-cols-7 gap-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, idx) => {
          const date = weekDates[idx]
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const dayActivities = activities.filter((a: any) => a.date === dateStr)
          const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const isFriday = date.getDay() === 5

          return (
            <div key={dayName} className="text-center">
              <div className={`font-semibold ${isFriday ? 'text-green-600' : 'text-gray-700'}`}>
                {dayName}
                {isFriday && ' 🕌'}
              </div>
              <div className={`text-2xl font-bold mt-2 ${isToday ? 'text-teal-600' :
                isFriday ? 'text-green-600' :
                  'text-gray-900'
                }`}>
                {date.getDate()}
              </div>
              <div className="mt-4 space-y-2">
                {dayActivities.map((activity: any) => (
                  <div
                    key={activity.id}
                    className={`text-xs p-2 rounded border-l-4 ${activity.activity.includes('Prayer') || activity.activity.includes('Jummah')
                      ? 'bg-green-100 text-green-800 border-green-500'
                      : 'bg-teal-100 text-teal-800 border-teal-500'
                      }`}
                  >
                    <div className="font-semibold truncate">{activity.activity}</div>
                    <div className="text-xs mt-1">👤 {activity.in_charge}</div>
                  </div>
                ))}
                {dayActivities.length === 0 && (
                  <div className="text-xs text-gray-400 italic">No activities</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Participant Schedule View Component
function ParticipantScheduleView({
  trainers,
  activities,
  selectedParticipant,
  setSelectedParticipant,
  currentDate
}: {
  trainers: any[]
  activities: any[]
  selectedParticipant: string
  setSelectedParticipant: (participant: string) => void
  currentDate: Date
}) {
  if (trainers.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
        <p className="text-lg font-semibold">No participants found</p>
        <p className="text-sm mt-2">Try adjusting your search or filters</p>
      </div>
    )
  }

  // Calculate week dates
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  // Helper function to format date as YYYY-MM-DD using local time
  const formatDateStr = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Helper function to get activities for a participant on a specific date
  const getActivitiesForParticipantDate = (trainer: any, date: Date) => {
    const dateStr = formatDateStr(date)
    return activities.filter((a: any) => 
      a.date === dateStr && (
        a.in_charge === trainer.name || 
        a.participants.includes(trainer.id)
      )
    )
  }

  // Count total activities per participant
  const getParticipantActivityCount = (trainer: any) => {
    return activities.filter((a: any) =>
      a.in_charge === trainer.name || a.participants.includes(trainer.id)
    ).length
  }

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Activities</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {activities.length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">This Month</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {activities.filter((a: any) => {
              const activityDate = new Date(a.date)
              return activityDate.getMonth() === currentDate.getMonth() &&
                activityDate.getFullYear() === currentDate.getFullYear()
            }).length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Active Participants</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {trainers.length}
          </div>
        </div>
      </div>

      {/* ✅ CORRECT: Participant Schedule Grid (like Trainer Schedule) */}
      <div className="bg-white rounded-lg shadow">
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Header Row */}
            <div className="bg-gray-50 border-b sticky top-0 z-20">
              <div className="flex">
                {/* Participant column header */}
                <div className="w-56 p-3 font-semibold border-r sticky left-0 bg-gray-50 z-30">
                  <div>Participant</div>
                  <div className="text-xs font-normal text-gray-600 mt-1">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </div>
                </div>
                
                {/* Date column headers */}
                {weekDates.map((date, idx) => {
                  const dateStr = formatDateStr(date)
                  const today = new Date()
                  const todayStr = formatDateStr(today)
                  const isToday = dateStr === todayStr
                  const isFriday = date.getDay() === 5

                  return (
                    <div
                      key={idx}
                      className={`min-w-[120px] p-2 text-center border-r ${
                        isToday ? 'bg-teal-50' : 
                        isFriday ? 'bg-green-50' : ''
                      }`}
                    >
                      <div className={`font-semibold text-xs ${
                        isFriday ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                        {isFriday && ' 🕌'}
                      </div>
                      <div className={`text-sm mt-1 ${
                        isToday ? 'text-teal-600 font-bold' :
                        isFriday ? 'text-green-600' :
                        'text-gray-600'
                      }`}>
                        {date.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Participant Rows */}
            <div>
              {trainers.map((trainer: any) => {
                const activityCount = getParticipantActivityCount(trainer)

                return (
                  <div key={trainer.id} className="flex border-b hover:bg-gray-50">
                    {/* Participant info column (sticky) */}
                    <div className="w-56 p-3 border-r sticky left-0 bg-white z-10">
                      <div className="font-semibold text-sm">{trainer.name}</div>
                      <div className="text-xs text-gray-600 mt-1">
                        {trainer.rank}
                      </div>
                      {trainer.specialization && (
                        <div className="text-xs text-gray-500 mt-0.5 truncate">
                          {trainer.specialization}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                          {trainer.status}
                        </span>
                        {activityCount > 0 && (
                          <span className="text-xs bg-teal-100 text-teal-700 px-2 py-1 rounded">
                            {activityCount} activity(s)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Activity cells for each day */}
                    {weekDates.map((date, idx) => {
                      const dayActivities = getActivitiesForParticipantDate(trainer, date)
                      const dateStr = formatDateStr(date)
                      const today = new Date()
                      const todayStr = formatDateStr(today)
                      const isToday = dateStr === todayStr
                      const isFriday = date.getDay() === 5

                      return (
                        <div
                          key={idx}
                          className={`min-w-[120px] p-2 border-r ${
                            isToday ? 'bg-teal-50' :
                            isFriday ? 'bg-green-50' :
                            ''
                          }`}
                        >
                          {dayActivities.length > 0 ? (
                            <div className="space-y-1">
                              {dayActivities.map((activity: any) => {
                                const isPrayer = activity.activity.includes('Prayer') || 
                                               activity.activity.includes('Jummah')
                                const isLeader = activity.in_charge === trainer.name

                                return (
                                  <div
                                    key={activity.id}
                                    className={`text-xs p-1.5 rounded border-l-4 ${
                                      isPrayer
                                        ? 'bg-green-100 text-green-800 border-green-500'
                                        : 'bg-teal-100 text-teal-800 border-teal-500'
                                    }`}
                                    title={activity.activity}
                                  >
                                    <div className="font-semibold truncate">
                                      {activity.activity}
                                    </div>
                                    {isLeader && (
                                      <div className="text-xs mt-0.5 flex items-center gap-1">
                                        <span>👤</span>
                                        <span>Leader</span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 text-center py-2">
                              —
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


// Activity Modal Component with Enhanced Filtering
function ActivityModal({
  date,
  trainers,
  onClose,
  onSubmit
}: {
  date: Date
  trainers: any[]
  onClose: () => void
  onSubmit: any
}) {
  const [formData, setFormData] = useState({
    activity: ACTIVITY_TYPES[0],
    in_charge: trainers[0]?.name || '',
    participants: [] as number[],
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Enhanced filtering states for participant selection
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRank, setFilterRank] = useState('')
  const [filterSpecialization, setFilterSpecialization] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('')

  // Filtered trainers
  const filteredTrainers = trainers.filter((t: any) => {
    const searchLower = searchQuery.toLowerCase()
    const matchesSearch = (
      t.name.toLowerCase().includes(searchLower) ||
      (t.rank || '').toLowerCase().includes(searchLower)
    )
    const matchesRank = !filterRank || t.rank === filterRank
    const matchesSpecialization = !filterSpecialization || t.specialization === filterSpecialization
    const matchesDepartment = !filterDepartment || t.department === filterDepartment
    
    return matchesSearch && matchesRank && matchesSpecialization && matchesDepartment
  })

  // Get unique values for filters
  const uniqueRanks = Array.from(new Set(trainers.map((t: any) => t.rank).filter(Boolean))).sort()
  const uniqueSpecializations = Array.from(new Set(trainers.map((t: any) => t.specialization).filter(Boolean))).sort()
  const uniqueDepartments = Array.from(new Set(trainers.map((t: any) => t.department).filter(Boolean))).sort()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    const result = await onSubmit({
      data: {
        date: dateStr,
        ...formData,
      }
    })

    if (result.success) {
      window.location.reload()
    }
    setIsSubmitting(false)
  }

  const toggleParticipant = (trainerId: number) => {
    setFormData(prev => ({
      ...prev,
      participants: prev.participants.includes(trainerId)
        ? prev.participants.filter(id => id !== trainerId)
        : [...prev.participants, trainerId]
    }))
  }

  const selectAll = () => {
    setFormData(prev => ({
      ...prev,
      participants: filteredTrainers.map((t: any) => t.id)
    }))
  }

  const deselectAll = () => {
    setFormData(prev => ({
      ...prev,
      participants: []
    }))
  }

  const isFriday = date.getDay() === 5

  return (
    <>
      {/* Modal Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto pointer-events-auto">
          {/* Modal Header */}
          <div className={`border-b px-6 py-4 flex justify-between items-center sticky top-0 ${isFriday ? 'bg-green-50' : 'bg-teal-50'
            }`}>
            <h3 className="text-xl font-semibold text-gray-900">
              Schedule Religious Activity
              {isFriday && <span className="ml-2 text-green-600">🕌 Friday</span>}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 text-2xl leading-none"
              type="button"
            >
              ×
            </button>
          </div>

          {/* Modal Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Date Display */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
              <input
                type="text"
                value={date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long'
                })}
                readOnly
                className="w-full px-4 py-2 border rounded-lg bg-gray-50"
              />
            </div>

            {/* Activity Type */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Activity Type *
              </label>
              <select
                required
                value={formData.activity}
                onChange={(e) => setFormData({ ...formData, activity: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
              >
                {ACTIVITY_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Leader/Imam */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Leader/Imam *
              </label>
              <select
                required
                value={formData.in_charge}
                onChange={(e) => setFormData({ ...formData, in_charge: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
              >
                {trainers.map(trainer => (
                  <option key={trainer.id} value={trainer.name}>
                    {trainer.rank} {trainer.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Participants with Enhanced Filtering */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Participants *
              </label>

              {/* Search and Filters */}
              <div className="mb-4 space-y-3">
                <input
                  type="text"
                  placeholder="Search participants..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
                />
                
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={filterRank}
                    onChange={(e) => setFilterRank(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">All Ranks</option>
                    {uniqueRanks.map((rank: any) => (
                      <option key={rank} value={rank}>{rank}</option>
                    ))}
                  </select>

                  <select
                    value={filterSpecialization}
                    onChange={(e) => setFilterSpecialization(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">All Specializations</option>
                    {uniqueSpecializations.map((spec: any) => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>

                  <select
                    value={filterDepartment}
                    onChange={(e) => setFilterDepartment(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">All Departments</option>
                    {uniqueDepartments.map((dept: any) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                {/* Select All / Deselect All */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="flex-1 px-4 py-2 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 font-semibold text-sm"
                  >
                    Select All ({filteredTrainers.length})
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Participant List */}
              <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                {filteredTrainers.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No participants match your filters
                  </p>
                ) : (
                  filteredTrainers.map((trainer: any) => (
                    <label
                      key={trainer.id}
                      className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.participants.includes(trainer.id)}
                        onChange={() => toggleParticipant(trainer.id)}
                        className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
                      />
                      <span className="text-sm">
                        <span className="font-medium">{trainer.rank}</span> {trainer.name}
                        {trainer.specialization && (
                          <span className="text-xs text-gray-500 ml-2">({trainer.specialization})</span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Selected: {formData.participants.length} participant(s)
                {filteredTrainers.length < trainers.length && (
                  <span className="ml-2 text-teal-600">
                    (Showing {filteredTrainers.length} of {trainers.length})
                  </span>
                )}
              </p>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || formData.participants.length === 0}
                className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Scheduling...' : 'Schedule Activity'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}