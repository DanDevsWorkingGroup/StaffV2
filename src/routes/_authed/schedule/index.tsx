import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to fetch schedule data
const getScheduleData = createServerFn({ method: 'GET' }).handler(async () => {
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

  // Get quick stats
  const todayStr = currentDate.toISOString().split('T')[0]
  
  // Count today's schedules with status not 'cancelled'
  const todaySchedules = schedules?.filter(s => 
    s.date === todayStr && s.status !== 'cancelled'
  ) || []

  // Count this week's schedules
  const weekSchedules = schedules?.filter(s => s.status !== 'cancelled') || []
  
  return {
    events: events || [],
    trainers: trainers || [],
    schedules: schedules || [],
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todaySchedules.length,
      thisWeekSessions: weekSchedules.length,
    }
  }
})

export const Route = createFileRoute('/_authed/schedule/')({
  loader: async () => await getScheduleData(),
  component: SchedulePage,
})

function SchedulePage() {
  const { events, trainers, schedules, stats } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<'week' | 'month' | 'trainer-schedule'>('week')

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
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() - 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded"
            >
              ◀
            </button>
            <h2 className="text-xl font-semibold">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() + 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded"
            >
              ▶
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => setView('week')}
              className={`px-4 py-2 rounded ${
                view === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded ${
                view === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView('trainer-schedule')}
              className={`px-4 py-2 rounded ${
                view === 'trainer-schedule' ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}
            >
              Trainer Schedule
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {view === 'week' ? (
          <WeeklyCalendar schedules={schedules} events={events} currentDate={currentDate} />
        ) : view === 'month' ? (
          <MonthlyCalendar schedules={schedules} events={events} currentDate={currentDate} />
        ) : (
          <TrainerScheduleGrid 
            trainers={trainers} 
            schedules={schedules}
            events={events}
            currentDate={currentDate} 
          />
        )}
      </div>

      {/* Trainer List Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">Active Trainers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map((trainer: any) => (
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

  // Helper function to check if an event occurs on a specific date
  const isEventOnDate = (event: any, date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
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
    const dateStr = date.toISOString().split('T')[0]
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
              const isToday = date.toDateString() === new Date().toDateString()
              const dayEvents = getEventsForDate(date)
              
              return (
                <div 
                  key={idx} 
                  className={`min-w-[100px] p-2 text-center border-r ${
                    isToday ? 'bg-blue-50' : ''
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
                  const isToday = date.toDateString() === new Date().toDateString()
                  
                  return (
                    <div 
                      key={idx} 
                      className={`min-w-[100px] p-2 border-r ${
                        isToday ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      {/* Show events first */}
                      {dayEvents.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {dayEvents.map((event) => (
                            <div 
                              key={event.id}
                              className="text-xs p-1.5 rounded border-l-4"
                              style={{ 
                                borderLeftColor: event.color || '#3b82f6',
                                backgroundColor: event.color ? `${event.color}15` : '#eff6ff'
                              }}
                              title={`${event.name} - ${event.category || 'Training'}`}
                            >
                              <div className="font-semibold truncate text-gray-800">
                                {event.name}
                              </div>
                              {event.category && (
                                <div className="text-xs text-gray-600 truncate">
                                  {event.category}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Show trainer schedule/status */}
                      {schedule ? (
                        <div className={`text-xs p-2 rounded border ${getStatusColor(schedule.status)}`}>
                          <div className="font-bold text-center mb-1">
                            {schedule.status?.toUpperCase()}
                          </div>
                          {schedule.availability && schedule.availability.length > 0 && (
                            <div className="text-xs text-center mt-1">
                              🕐 {formatAvailability(schedule.availability)}
                            </div>
                          )}
                          {schedule.notes && (
                            <div className="text-xs text-center mt-1 truncate" title={schedule.notes}>
                              📝 {schedule.notes}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center text-gray-300 text-xs py-2">
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

        {/* Summary Footer */}
        <div className="bg-gray-50 border-t">
          <div className="flex">
            <div className="w-56 p-3 font-semibold border-r sticky left-0 bg-gray-50">
              Total Active
            </div>
            {dates.map((date, idx) => {
              const dateStr = date.toISOString().split('T')[0]
              const daySchedules = schedules.filter(
                s => s.date === dateStr && s.status !== 'cancelled'
              ).length
              
              return (
                <div 
                  key={idx} 
                  className="min-w-[100px] p-3 text-center border-r font-semibold"
                >
                  {daySchedules > 0 ? daySchedules : '—'}
                </div>
              )
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="bg-gray-50 p-4 border-t">
          <div className="text-sm font-semibold mb-3">Legend:</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
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

// Weekly Calendar View
function WeeklyCalendar({ schedules, events, currentDate }: { 
  schedules: any[]; 
  events: any[];
  currentDate: Date;
}) {
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
          const dayEvents = events.filter(e => isEventOnDate(e, date))
          
          return (
            <div key={day} className="text-center">
              <div className="font-semibold text-gray-700">{day}</div>
              <div className="text-2xl font-bold text-gray-900 mt-2">
                {date.getDate()}
              </div>
              <div className="mt-4 space-y-2">
                {/* Show Events */}
                {dayEvents.map(event => (
                  <div 
                    key={event.id}
                    className="text-xs p-2 rounded border-l-4"
                    style={{ 
                      borderLeftColor: event.color || '#3b82f6',
                      backgroundColor: event.color ? `${event.color}15` : '#eff6ff'
                    }}
                  >
                    <div className="font-semibold">{event.name}</div>
                    {event.category && (
                      <div className="text-xs text-gray-600">{event.category}</div>
                    )}
                  </div>
                ))}
                
                {/* Show Trainer Schedules */}
                {daySchedules.map(schedule => (
                  <div 
                    key={schedule.id} 
                    className="bg-green-100 text-green-800 text-xs p-2 rounded"
                  >
                    <div className="font-semibold">{schedule.trainer?.name}</div>
                    <div className="text-xs">{schedule.status}</div>
                    {schedule.availability && schedule.availability.length > 0 && (
                      <div className="text-xs">{schedule.availability.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Monthly Calendar View
function MonthlyCalendar({ schedules, events, currentDate }: { 
  schedules: any[]; 
  events: any[];
  currentDate: Date;
}) {
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  const startDay = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const calendar = []

  for (let i = 0; i < startDay; i++) {
    calendar.push(null)
  }

  for (let day = 1; day <= daysInMonth; day++) {
    calendar.push(day)
  }

  const isEventOnDate = (event: any, dateStr: string) => {
    return dateStr >= event.start_date && dateStr <= event.end_date
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-2 mb-2">
        {days.map(day => (
          <div key={day} className="text-center font-semibold text-gray-700 py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {calendar.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="aspect-square" />
          }

          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const daySchedules = schedules.filter(s => s.date === dateStr)
          const dayEvents = events.filter(e => isEventOnDate(e, dateStr))

          return (
            <div 
              key={day} 
              className="aspect-square border rounded-lg p-2 hover:shadow-md transition cursor-pointer"
            >
              <div className="font-semibold text-gray-900">{day}</div>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 1).map(event => (
                  <div 
                    key={event.id}
                    className="text-xs p-1 rounded border-l-2"
                    style={{ 
                      borderLeftColor: event.color || '#3b82f6',
                      backgroundColor: event.color ? `${event.color}20` : '#eff6ff'
                    }}
                    title={event.name}
                  >
                    {event.name.substring(0, 8)}
                  </div>
                ))}
                {daySchedules.slice(0, 1).map(schedule => (
                  <div 
                    key={schedule.id}
                    className="bg-green-100 text-green-800 text-xs p-1 rounded truncate"
                    title={`${schedule.trainer?.name} - ${schedule.status}`}
                  >
                    {schedule.trainer?.name?.substring(0, 8)}
                  </div>
                ))}
                {(dayEvents.length + daySchedules.length) > 2 && (
                  <div className="text-xs text-gray-600">
                    +{dayEvents.length + daySchedules.length - 2} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}