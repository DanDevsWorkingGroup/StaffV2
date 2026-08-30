import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState, useEffect } from 'react'
import { MonthCalendar, type CalItem } from '~/components/mobile'

// NEW: Server function to fetch schedule data for a specific month
const getScheduleDataForMonth = createServerFn({ method: 'POST' })
  .inputValidator((data: { year: number; month: number }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), [])

    const supabase = getSupabaseServerClient()

    const { year, month } = data
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    const firstDayStr = firstDay.toISOString().split('T')[0]
    const lastDayStr = lastDay.toISOString().split('T')[0]

    // Fetch events for the specified month
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .or(`start_date.lte.${lastDayStr},end_date.gte.${firstDayStr}`)
      .order('start_date', { ascending: true })

    // Fetch schedules for the specified month
    const { data: schedules } = await supabase
      .from('schedules')
      .select(`
        *,
        trainer:trainers(id, name, rank, specialization)
      `)
      .gte('date', firstDayStr)
      .lte('date', lastDayStr)
      .order('date', { ascending: true })

    return {
      events: events || [],
      schedules: schedules || [],
    }
  })
// Server function to fetch schedule data
const getInitialScheduleData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()

  const currentDate = new Date()
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

  const firstDayStr = firstDay.toISOString().split('T')[0]
  const lastDayStr = lastDay.toISOString().split('T')[0]

  // Fetch events (training courses/programs) for the current month
  const { data: events } = await supabase
    .from('events')
    .select('*')
    .or(`start_date.lte.${lastDayStr},end_date.gte.${firstDayStr}`)
    .order('start_date', { ascending: true })

  // Fetch all active trainers
  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true })

  // Fetch schedules (trainer assignments and availability)
  const { data: schedules } = await supabase
    .from('schedules')
    .select(`
      *,
      trainer:trainers(id, name, rank, specialization)
    `)
    .gte('date', firstDayStr)
    .lte('date', lastDayStr)
    .order('date', { ascending: true })

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

 // Get quick stats
  const todayStr = currentDate.toISOString().split('T')[0]

  // Count today's schedules with status not 'cancelled'
  const todaySchedules = schedules?.filter(s =>
    s.date === todayStr && s.status !== 'cancelled'
  ) || []

  // FIXED: Calculate current week properly
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1) // Monday as start
  startOfWeek.setDate(diff)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6) // Sunday as end

  const startOfWeekStr = startOfWeek.toISOString().split('T')[0]
  const endOfWeekStr = endOfWeek.toISOString().split('T')[0]

  // Count THIS WEEK's schedules only
  const weekSchedules = schedules?.filter(s => 
    s.date >= startOfWeekStr && 
    s.date <= endOfWeekStr && 
    s.status !== 'cancelled'
  ) || []

  return {
    events: events || [],
    trainers: trainers || [],
    schedules: schedules || [],
    currentTrainer,
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todaySchedules.length,
      thisWeekSessions: weekSchedules.length,
    }
  }
})

export const Route = createFileRoute('/_authed/schedule/')({
  loader: async () => await getInitialScheduleData(),
  component: SchedulePage,
})

function SchedulePage() {
  const initialData = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<'week' | 'month' | 'trainer-schedule' | 'my-schedule'>('week')
  
  // FIXED: State for dynamic data loading
  const [events, setEvents] = useState(initialData.events)
  const [schedules, setSchedules] = useState(initialData.schedules)
  const [isLoading, setIsLoading] = useState(false)
  
  // Static data that doesn't change with month navigation
  const { trainers, currentTrainer, stats } = initialData
  
// RBAC: Check if user can access Trainer Schedule (only ADMIN and COORDINATOR)
const canAccessTrainerSchedule = currentTrainer?.roles?.name && 
  ['ADMIN', 'COORDINATOR'].includes(currentTrainer.roles.name)
  
  // Filter states for Active Trainers section
  const [trainerSearchQuery, setTrainerSearchQuery] = useState('')
  const [trainerFilterRank, setTrainerFilterRank] = useState('')
  const [trainerFilterSpecialization, setTrainerFilterSpecialization] = useState('')
  const [trainerFilterDepartment, setTrainerFilterDepartment] = useState('')

  // Filter states for Trainer Schedule Grid
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('')
  const [scheduleFilterRank, setScheduleFilterRank] = useState('')
  const [scheduleFilterSpecialization, setScheduleFilterSpecialization] = useState('')
  const [scheduleFilterDepartment, setScheduleFilterDepartment] = useState('')

  // FIXED: Refetch data when month changes for month-based views
  useEffect(() => {
    const fetchMonthData = async () => {
      // Only fetch if in month-based views
      if (view !== 'trainer-schedule' && view !== 'my-schedule') {
        return
      }

      setIsLoading(true)
      try {
        const result = await getScheduleDataForMonth({
          data: {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth(),
          }
        })
        
        setEvents(result.events)
        setSchedules(result.schedules)
      } catch (error) {
        console.error('Error fetching month data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchMonthData()
  }, [currentDate, view])

  // Filtered trainers for Active Trainers section
  const filteredActiveTrainers = trainers.filter((t: any) => {
    const searchLower = trainerSearchQuery.toLowerCase()
    const matchesSearch = (
      t.name.toLowerCase().includes(searchLower) ||
      (t.rank || '').toLowerCase().includes(searchLower) ||
      (t.specialization || '').toLowerCase().includes(searchLower)
    )
    const matchesRank = !trainerFilterRank || t.rank === trainerFilterRank
    const matchesSpecialization = !trainerFilterSpecialization || t.specialization === trainerFilterSpecialization
    const matchesDepartment = !trainerFilterDepartment || t.department === trainerFilterDepartment
    
    return matchesSearch && matchesRank && matchesSpecialization && matchesDepartment
  })

  // Filtered trainers for Trainer Schedule Grid
  const filteredScheduleTrainers = trainers.filter((t: any) => {
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Training Schedule</h1>
        <p className="text-gray-600">Manage and view all training schedules</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Active Trainers"
          value={stats.activeTrainers}
          icon="👥"
          color="bg-blue-500"
        />
        <StatCard
          title="Today's Sessions"
          value={stats.todaySessions}
          icon="📅"
          color="bg-green-500"
        />
        <StatCard
          title="This Week"
          value={stats.thisWeekSessions}
          icon="📊"
          color="bg-purple-500"
        />
      </div>

      {/* Calendar Controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          {/* Navigation - Smart Month/Week Navigation */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                // ✅ FIXED: Check view type
                if (view === 'week' || view === 'trainer-schedule' || view === 'my-schedule') {
                  // Move backward by 7 days (1 week)
                  newDate.setDate(currentDate.getDate() - 7)
                } else {
                  // Move backward by 1 month
                  newDate.setMonth(currentDate.getMonth() - 1)
                }
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              ◀ Previous
            </button>

            <h2 className="text-2xl font-bold text-gray-900">
              {view === 'week' || view === 'trainer-schedule' || view === 'my-schedule'
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
                // ✅ FIXED: Check view type
                if (view === 'week' || view === 'trainer-schedule' || view === 'my-schedule') {
                  // Move forward by 7 days (1 week)
                  newDate.setDate(currentDate.getDate() + 7)
                } else {
                  // Move forward by 1 month
                  newDate.setMonth(currentDate.getMonth() + 1)
                }
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              Next ▶
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setView('week')}
              className={`px-4 py-2 rounded ${view === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded ${view === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
            >
              Month
            </button>
            {/* Show Trainer Schedule only for ADMIN and COORDINATOR */}
{canAccessTrainerSchedule && (
  <button
    onClick={() => setView('trainer-schedule')}
    className={`px-4 py-2 rounded ${view === 'trainer-schedule' ? 'bg-blue-600 text-white' : 'bg-gray-200'
      }`}
  >
    Trainer Schedule
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

  {/* Loading Indicator */}
      {isLoading && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg">
          <div className="flex items-center space-x-2">
            <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="font-medium">Loading schedule data...</span>
          </div>
        </div>
      )}
      {/* Calendar Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {view === 'week' ? (
          <WeeklyCalendar schedules={schedules} events={events} currentDate={currentDate} currentTrainer={currentTrainer} />
        ) : view === 'month' ? (
          <MonthlyCalendar schedules={schedules} events={events} currentDate={currentDate} currentTrainer={currentTrainer} />
        ) : view === 'my-schedule' ? (
          <MyScheduleGrid
            currentTrainer={currentTrainer}
            schedules={schedules}
            events={events}
            currentDate={currentDate}
          />
        ) : canAccessTrainerSchedule ? (
  <>
    {/* Filters for Trainer Schedule Grid */}
            <div className="bg-gray-50 p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900 mb-4">🔍 Filter Trainers</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Search by Name
                  </label>
                  <input
                    type="text"
                    placeholder="Search trainers..."
                    value={scheduleSearchQuery}
                    onChange={(e) => setScheduleSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                    <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
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
                Showing <span className="font-bold text-gray-900">{filteredScheduleTrainers.length}</span> of <span className="font-bold text-gray-900">{trainers.length}</span> trainers
              </div>
            </div>

            <TrainerScheduleGrid
              trainers={filteredScheduleTrainers}
              schedules={schedules}
              events={events}
              currentDate={currentDate}
            />
          </>
        ) : (
          <div className="p-8 text-center">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 inline-block">
              <p className="text-yellow-800 font-semibold">⚠️ Unauthorized Access</p>
              <p className="text-yellow-700 mt-2">Only Administrators and Coordinators can access the Trainer Schedule view.</p>
            </div>
          </div>
        )}
      </div>

      {/* Active Trainers List Section with Filtering */}
      <div className="bg-white rounded-lg shadow">
        {/* Filter Section */}
        <div className="p-6 border-b bg-gray-50">
          <h3 className="text-xl font-semibold mb-4">🔍 Filter Active Trainers</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Search by Name
              </label>
              <input
                type="text"
                placeholder="Search trainers..."
                value={trainerSearchQuery}
                onChange={(e) => setTrainerSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Rank Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filter by Rank
              </label>
              <select
                value={trainerFilterRank}
                onChange={(e) => setTrainerFilterRank(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                value={trainerFilterSpecialization}
                onChange={(e) => setTrainerFilterSpecialization(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                value={trainerFilterDepartment}
                onChange={(e) => setTrainerFilterDepartment(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Departments</option>
                {uniqueDepartments.map((dept: any) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Filters Summary */}
          {(trainerSearchQuery || trainerFilterRank || trainerFilterSpecialization || trainerFilterDepartment) && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
              {trainerSearchQuery && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                  Search: "{trainerSearchQuery}"
                  <button onClick={() => setTrainerSearchQuery('')} className="ml-2">✕</button>
                </span>
              )}
              {trainerFilterRank && (
                <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                  Rank: {trainerFilterRank}
                  <button onClick={() => setTrainerFilterRank('')} className="ml-2">✕</button>
                </span>
              )}
              {trainerFilterSpecialization && (
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  Spec: {trainerFilterSpecialization}
                  <button onClick={() => setTrainerFilterSpecialization('')} className="ml-2">✕</button>
                </span>
              )}
              {trainerFilterDepartment && (
                <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                  Dept: {trainerFilterDepartment}
                  <button onClick={() => setTrainerFilterDepartment('')} className="ml-2">✕</button>
                </span>
              )}
              <button
                onClick={() => {
                  setTrainerSearchQuery('')
                  setTrainerFilterRank('')
                  setTrainerFilterSpecialization('')
                  setTrainerFilterDepartment('')
                }}
                className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold hover:bg-red-200"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Results Count */}
          <div className="mt-4 text-sm text-gray-600">
            Showing <span className="font-bold text-gray-900">{filteredActiveTrainers.length}</span> of <span className="font-bold text-gray-900">{trainers.length}</span> trainers
          </div>
        </div>

        {/* Trainers Grid */}
        <div className="p-6">
          {filteredActiveTrainers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg font-semibold">No trainers found</p>
              <p className="text-sm mt-2">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredActiveTrainers.map((trainer: any) => (
                <div key={trainer.id} className="p-4 border rounded-lg hover:shadow-md transition">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-xl">👤</span>
                    </div>
                    <div>
                      <p className="font-semibold">{trainer.name}</p>
                      <p className="text-sm text-gray-600">{trainer.rank}</p>
                      {trainer.specialization && (
                        <p className="text-xs text-gray-500">{trainer.specialization}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Legend</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-100 border border-blue-300 rounded"></div>
              <span>Scheduled</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-yellow-100 border border-yellow-300 rounded"></div>
              <span>In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-green-100 border border-green-300 rounded"></div>
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-red-100 border border-red-300 rounded"></div>
              <span>Cancelled</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-600">
            <strong>Events</strong> are shown with colored left borders. <strong>Trainer status</strong> is shown in colored blocks with availability times.
          </div>
        </div>
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

// Helper function to filter events based on user role and assignments
const filterEventsForUser = (
  events: any[],
  schedules: any[],
  currentTrainer: any | null,
  date: Date
) => {
  // If no trainer or no role, show no events
  if (!currentTrainer || !currentTrainer.roles?.name) {
    return []
  }

  const userRole = currentTrainer.roles.name

  // ADMIN and COORDINATOR can see all events
  if (['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'].includes(userRole)) {
    return events
  }

  // For TRAINER role, filter to show only assigned events
  if (userRole === 'TRAINER') {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    
    // Get schedule for this trainer on this date
    const trainerSchedule = schedules.find(
      s => s.trainer_id === currentTrainer.id && s.date === dateStr
    )

    if (!trainerSchedule) {
      return []
    }

    // Helper to extract event name from notes
    const extractEventName = (notes: string | null): string | null => {
      if (!notes) return null
      if (notes.includes('Assigned to:')) {
        return notes.replace('Assigned to:', '').trim()
      }
      return null
    }

    // Filter events to show only assigned ones
    return events.filter(event => {
      const notesEventName = extractEventName(trainerSchedule.notes)
      
      // Exact match with event name (case-insensitive)
      if (notesEventName && notesEventName.toLowerCase() === event.name.toLowerCase()) {
        return true
      }
      
      return false
    })
  }

  // Default: show no events for unknown roles
  return []
}

// My Schedule Grid Component - Shows only the current user's schedule
function MyScheduleGrid({
  currentTrainer,
  schedules,
  events,
  currentDate
}: {
  currentTrainer: any;
  schedules: any[];
  events: any[];
  currentDate: Date;
}) {
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  const daysInMonth = lastDay.getDate()

  // Generate all dates in the month
  const dates = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(firstDay)
    date.setDate(firstDay.getDate() + i)
    return date
  })

  // Helper function to format date as YYYY-MM-DD using local time
  const formatDateStr = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Helper function to check if an event occurs on a specific date
  const isEventOnDate = (event: any, date: Date) => {
    const dateStr = formatDateStr(date)
    const startDate = event.start_date
    const endDate = event.end_date

    return dateStr >= startDate && dateStr <= endDate
  }

  // Helper function to get events on a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => isEventOnDate(event, date))
  }

  // Helper function to get schedule for the current trainer on a specific date
  const getScheduleForDate = (date: Date) => {
    const dateStr = formatDateStr(date)
    return schedules.find(s => s.trainer_id === currentTrainer.id && s.date === dateStr)
  }

  // Helper function to format availability times
  const formatAvailability = (availability: string[] | null) => {
    if (!availability || availability.length === 0) return ''
    return availability.join(', ')
  }

  // Helper function to get status color
  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  if (!currentTrainer) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p className="text-lg font-semibold">Unable to load your schedule</p>
        <p className="text-sm mt-2">Please ensure you are logged in as a trainer</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
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

        {/* Calendar Grid */}
        <div className="bg-gray-50 border-b sticky top-0 z-20">
          <div className="flex">
            {/* Month/Year column header */}
            <div className="w-40 p-3 font-semibold border-r sticky left-0 bg-gray-50 z-30">
              <div className="text-xs text-gray-600">
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
            </div>
            {/* Date headers */}
            {dates.map((date, idx) => {
              const dateStr = formatDateStr(date)
              const today = new Date()
              const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
              const isToday = dateStr === todayStr

              const dayEvents = getEventsForDate(date)

              return (
                <div
                  key={idx}
                  className={`min-w-[100px] p-2 text-center border-r ${isToday ? 'bg-teal-50' : ''
                    }`}
                >
                  <div className="font-semibold text-xs">
                    {date.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm mt-1 ${isToday ? 'text-teal-600 font-bold' : 'text-gray-600'}`}>
                    {date.getDate()}
                  </div>
                  {/* Show event indicator if there's an event on this date */}
                  {dayEvents.length > 0 && (
                    <div className="mt-1">
                      {dayEvents.map(event => (
                        <div
                          key={event.id}
                          className="w-2 h-2 rounded-full mx-auto"
                          style={{ backgroundColor: event.color || '#3b82f6' }}
                          title={event.name}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Schedule row */}
        <div className="flex border-b hover:bg-gray-50">
          {/* Trainer info column */}
          <div className="w-40 p-3 border-r sticky left-0 bg-white z-10">
            <div className="font-semibold text-sm">{currentTrainer.name}</div>
            <div className="text-xs text-gray-600 mt-1">
              {currentTrainer.specialization || currentTrainer.rank}
            </div>
          </div>

          {/* Schedule cells */}
          {dates.map((date, idx) => {
            const schedule = getScheduleForDate(date)
            const dayEvents = getEventsForDate(date)
            const dateStr = formatDateStr(date)
            const today = new Date()
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
            const isToday = dateStr === todayStr

           // Helper function to extract event name from notes
            const extractEventNameFromNotes = (notes: string | null): string | null => {
              if (!notes) return null
              
              // Notes format: "Assigned to: Event Name"
              if (notes.includes('Assigned to:')) {
                return notes.replace('Assigned to:', '').trim()
              }
              
              return null
            }

            // Filter events to only show assigned ones
            const assignedEvents = dayEvents.filter(event => {
              if (!schedule) return false
              
              // Extract event name from schedule notes
              const notesEventName = extractEventNameFromNotes(schedule.notes)
              
              // Exact match with event name (case-insensitive)
              if (notesEventName && notesEventName.toLowerCase() === event.name.toLowerCase()) {
                return true
              }
              
              // Fallback: check if schedule exists during event period
              const isScheduledDuringEvent = schedule.status === 'scheduled' && isEventOnDate(event, date)
              
              return isScheduledDuringEvent
            })


            return (
              <div
                key={idx}
                className={`min-w-[100px] p-2 border-r ${isToday ? 'bg-teal-50' : ''
                  }`}
              >
                {schedule ? (
                  <div className="space-y-1">
                    {/* Show assigned events with colored borders */}
                    {assignedEvents.map(event => (
                      <div
                        key={event.id}
                        className="text-xs p-1.5 rounded border-l-4"
                        style={{
                          borderLeftColor: event.color || '#3b82f6',
                          backgroundColor: event.color ? `${event.color}15` : '#eff6ff'
                        }}
                        title={event.name}
                      >
                        <div className="font-semibold truncate">{event.name}</div>
                      </div>
                    ))}

                    {/* Show trainer status */}
                    <div
                      className={`text-xs p-1.5 rounded border ${getStatusColor(schedule.status)}`}
                      title={schedule.notes || schedule.status}
                    >
                      <div className="font-semibold">{schedule.status}</div>
                      {schedule.availability && schedule.availability.length > 0 && (
                        <div className="text-xs mt-0.5 truncate">
                          {formatAvailability(schedule.availability)}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 text-center">—</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Trainer Schedule Grid Component
function TrainerScheduleGrid({
  trainers,
  schedules,
  events,
  currentDate
}: {
  trainers: any[];
  schedules: any[];
  events: any[];
  currentDate: Date;
}) {
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  const daysInMonth = lastDay.getDate()

  // Generate all dates in the month
  const dates = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(firstDay)
    date.setDate(firstDay.getDate() + i)
    return date
  })

  // Helper function to format date as YYYY-MM-DD using local time
  const formatDateStr = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Helper function to check if an event occurs on a specific date
  const isEventOnDate = (event: any, date: Date) => {
    const dateStr = formatDateStr(date)
    const startDate = event.start_date
    const endDate = event.end_date

    return dateStr >= startDate && dateStr <= endDate
  }

  // Helper function to get events on a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => isEventOnDate(event, date))
  }

  // Helper function to get schedule for a trainer on a specific date
  const getScheduleForTrainerDate = (trainerId: number, date: Date) => {
    const dateStr = formatDateStr(date)
    return schedules.find(s => s.trainer_id === trainerId && s.date === dateStr)
  }

  // Helper function to format availability times
  const formatAvailability = (availability: string[] | null) => {
    if (!availability || availability.length === 0) return ''
    return availability.join(', ')
  }

  // Helper function to get status color
  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  // Calculate total schedules per trainer
  const getTrainerScheduleCount = (trainerId: number) => {
    return schedules.filter(s => s.trainer_id === trainerId && s.status !== 'cancelled').length
  }

  if (trainers.length === 0) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p className="text-lg font-semibold">No trainers found</p>
        <p className="text-sm mt-2">Try adjusting your search or filters</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Header */}
        <div className="bg-gray-50 border-b sticky top-0 z-20">
          <div className="flex">
            {/* Trainer column header */}
            <div className="w-56 p-3 font-semibold border-r sticky left-0 bg-gray-50 z-30">
              <div>Trainer</div>
              <div className="text-xs font-normal text-gray-600 mt-1">
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
            </div>
            {/* Date headers */}
            {dates.map((date, idx) => {
              const dateStr = formatDateStr(date)
              // Compare with local Today
              const today = new Date()
              const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
              const isToday = dateStr === todayStr

              const dayEvents = getEventsForDate(date)

              return (
                <div
                  key={idx}
                  className={`min-w-[100px] p-2 text-center border-r ${isToday ? 'bg-blue-50' : ''
                    }`}
                >
                  <div className="font-semibold text-xs">
                    {date.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm mt-1 ${isToday ? 'text-blue-600 font-bold' : 'text-gray-600'}`}>
                    {date.getDate()}
                  </div>
                  {/* Show event indicator if there's an event on this date */}
                  {dayEvents.length > 0 && (
                    <div className="mt-1">
                      {dayEvents.map(event => (
                        <div
                          key={event.id}
                          className="w-2 h-2 rounded-full mx-auto"
                          style={{ backgroundColor: event.color || '#3b82f6' }}
                          title={event.name}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Trainer rows */}
        <div>
          {trainers.map((trainer) => {
            const scheduleCount = getTrainerScheduleCount(trainer.id)

            return (
              <div key={trainer.id} className="flex border-b hover:bg-gray-50">
                {/* Trainer info column */}
                <div className="w-56 p-3 border-r sticky left-0 bg-white z-10">
                  <div className="font-semibold text-sm">{trainer.name}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {trainer.specialization || trainer.rank}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                      {trainer.status}
                    </span>
                    {scheduleCount > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                        {scheduleCount} days
                      </span>
                    )}
                  </div>
                </div>

                {/* Schedule cells */}
                {dates.map((date, idx) => {
                  const schedule = getScheduleForTrainerDate(trainer.id, date)
                  const dayEvents = getEventsForDate(date)
                  const dateStr = formatDateStr(date)
                  const today = new Date()
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
                  const isToday = dateStr === todayStr

                  // Filter events to only show assigned ones
                  // IMPROVED: Check note matching OR if the trainer simply has a 'scheduled' status during an event
                  const assignedEvents = dayEvents.filter(event => {
                    const eventName = event.name.toLowerCase()
                    const noteMatch = schedule?.notes?.toLowerCase().includes(eventName)
                    const isScheduledDuringEvent = schedule?.status === 'scheduled' && isEventOnDate(event, date)
                    return noteMatch || isScheduledDuringEvent
                  })

                  return (
                    <div
                      key={idx}
                      className={`min-w-[100px] p-2 border-r ${isToday ? 'bg-blue-50' : ''
                        }`}
                    >
                      {schedule ? (
                        <div className="space-y-1">
                          {/* Show assigned events with colored borders */}
                          {assignedEvents.map(event => (
                            <div
                              key={event.id}
                              className="text-xs p-1.5 rounded border-l-4"
                              style={{
                                borderLeftColor: event.color || '#3b82f6',
                                backgroundColor: event.color ? `${event.color}15` : '#eff6ff'
                              }}
                              title={event.name}
                            >
                              <div className="font-semibold truncate">{event.name}</div>
                            </div>
                          ))}

                          {/* Show trainer status */}
                          <div
                            className={`text-xs p-1.5 rounded border ${getStatusColor(schedule.status)}`}
                            title={schedule.notes || schedule.status}
                          >
                            <div className="font-semibold">{schedule.status}</div>
                            {schedule.availability && schedule.availability.length > 0 && (
                              <div className="text-xs mt-0.5 truncate">
                                {formatAvailability(schedule.availability)}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 text-center">—</div>
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
  )
}

// Weekly Calendar View
function WeeklyCalendar({ 
  schedules, 
  events, 
  currentDate,
  currentTrainer  // ADD THIS PARAMETER
}: {
  schedules: any[];
  events: any[];
  currentDate: Date;
  currentTrainer: any | null;  // ADD THIS TYPE
}) {
  const navigate = useNavigate()
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  const isEventOnDate = (event: any, date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    return dateStr >= event.start_date && dateStr <= event.end_date
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          const date = weekDates[idx]
          const dateStr = date.toISOString().split('T')[0]
          const daySchedules = schedules.filter(s => s.date === dateStr)
          
          // 🔥 NEW: Filter events based on user role
          const allDayEvents = events.filter(e => isEventOnDate(e, date))
          const dayEvents = filterEventsForUser(allDayEvents, schedules, currentTrainer, date)

          return (
            <div key={day} className="text-center">
              <div className="font-semibold text-gray-700">{day}</div>
              <div className="text-2xl font-bold text-gray-900 mt-2">
                {date.getDate()}
              </div>
              <div className="mt-4 space-y-2">
                {/* Show Events with Trainer Count */}
                {dayEvents.map(event => {
                  // Count trainers assigned to this event
                  const eventTrainerCount = daySchedules.filter(s => {
                    if (!s || !s.notes || !event || !event.name) return false
                    
                    // Extract event name from notes
                    const notesEventName = s.notes.replace('Assigned to:', '').trim()
                    
                    // Exact match (case-insensitive)
                    return notesEventName.toLowerCase() === event.name.toLowerCase()
                  }).length;

                  return (
                    <div
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate({ to: '/events/$id', params: { id: event.id } })
                      }}
                      className="text-xs p-2 rounded border-l-4 cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        borderLeftColor: event.color || '#3b82f6',
                        backgroundColor: event.color ? `${event.color}15` : '#eff6ff'
                      }}
                      title={`${event.name} - ${eventTrainerCount} trainer(s)`}
                    >
                      <div className="font-semibold truncate">{event.name}</div>
                      {event.category && (
                        <div className="text-xs text-gray-500 mt-1">{event.category}</div>
                      )}
                      {eventTrainerCount > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 text-gray-600">
                          <span>👥</span>
                          <span className="font-medium">{eventTrainerCount}</span>
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Monthly Calendar View
function MonthlyCalendar({ 
  schedules, 
  events, 
  currentDate,
  currentTrainer  // ADD THIS PARAMETER
}: {
  schedules: any[];
  events: any[];
  currentDate: Date;
  currentTrainer: any | null;  // ADD THIS TYPE
}) {
  const navigate = useNavigate()

  const isEventOnDate = (event: any, dateStr: string) => {
    return dateStr >= event.start_date && dateStr <= event.end_date
  }

  return (
    <div className="p-4">
      <MonthCalendar
        monthDate={currentDate}
        accentClass="text-teal-600"
        todayRingClass="border-teal-500 bg-teal-50"
        getItems={(day) => {
          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
          const allDayEvents = events.filter((e) => isEventOnDate(e, dateStr))
          const dayEvents = filterEventsForUser(allDayEvents, schedules, currentTrainer, date)
          return dayEvents.map((event: any): CalItem => ({
            key: event.id,
            label: event.name,
            color: event.color || '#3b82f6',
            onClick: () => navigate({ to: '/events/$id', params: { id: event.id } }),
          }))
        }}
      />
    </div>
  )
}