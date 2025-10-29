import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to get all trainer overview data
const getTrainerOverviewData = createServerFn({ method: 'GET' })
  .inputValidator((data: { trainerId?: number; month: number; year: number }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    
    // Get all trainers
    const { data: trainers } = await supabase
      .from('trainers')
      .select('*')
      .eq('status', 'active')
      .order('name')

    // Get religious activities for the month
    const startDate = `${data.year}-${String(data.month + 1).padStart(2, '0')}-01`
    const endDate = new Date(data.year, data.month + 1, 0)
    const endDateStr = `${data.year}-${String(data.month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

    const { data: religiousActivities } = await supabase
      .from('religious_activities')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr)

    // Get physical training for the month
    const { data: physicalTraining } = await supabase
      .from('physical_training')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr)

    // Get events for the month
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .or(`start_date.lte.${endDateStr},end_date.gte.${startDate}`)

    // Get schedules for the trainer if selected
    let schedules = []
    if (data.trainerId) {
      const { data: trainerSchedules } = await supabase
        .from('schedules')
        .select('*')
        .eq('trainer_id', data.trainerId)
        .gte('date', startDate)
        .lte('date', endDateStr)
      schedules = trainerSchedules || []
    }

    return {
      trainers: trainers || [],
      religiousActivities: religiousActivities || [],
      physicalTraining: physicalTraining || [],
      events: events || [],
      schedules: schedules || []
    }
  })

export const Route = createFileRoute('/_authed/trainer-overview/')({
  loader: async () => {
    const now = new Date()
    return await getTrainerOverviewData({ 
      data: { 
        month: now.getMonth(), 
        year: now.getFullYear() 
      } 
    })
  },
  component: TrainerOverviewPage,
})

function TrainerOverviewPage() {
  const initialData = Route.useLoaderData()
  const [trainers] = useState(initialData.trainers)
  const [selectedTrainer, setSelectedTrainer] = useState<number | null>(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  
  // State for fetched data
  const [religiousActivities, setReligiousActivities] = useState(initialData.religiousActivities)
  const [physicalTraining, setPhysicalTraining] = useState(initialData.physicalTraining)
  const [events, setEvents] = useState(initialData.events)
  const [schedules, setSchedules] = useState(initialData.schedules)

  // Reload data when trainer or month changes
  const reloadData = async (trainerId: number | null, month: number, year: number) => {
    const data = await getTrainerOverviewData({ 
      data: { trainerId: trainerId || undefined, month, year } 
    })
    setReligiousActivities(data.religiousActivities)
    setPhysicalTraining(data.physicalTraining)
    setEvents(data.events)
    setSchedules(data.schedules)
  }

  // Handle trainer selection
  const handleTrainerChange = async (trainerId: string) => {
    const id = trainerId ? parseInt(trainerId) : null
    setSelectedTrainer(id)
    setSelectedDate(null)
    if (id) {
      await reloadData(id, currentDate.getMonth(), currentDate.getFullYear())
    }
  }

  // Handle month change
  const handleMonthChange = async (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    if (direction === 'prev') {
      newDate.setMonth(currentDate.getMonth() - 1)
    } else {
      newDate.setMonth(currentDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
    setSelectedDate(null)
    if (selectedTrainer) {
      await reloadData(selectedTrainer, newDate.getMonth(), newDate.getFullYear())
    }
  }

  // Get selected trainer object
  const trainer = trainers.find(t => t.id === selectedTrainer)

  // Calculate monthly summary
  const getMonthlySummary = () => {
    if (!selectedTrainer) {
      return { religious: 0, events: 0, physical: 0, leadership: 0 }
    }

    // Count religious activities
    const religious = religiousActivities.filter((activity: any) =>
      activity.in_charge === trainer?.name || 
      activity.participants.includes(selectedTrainer)
    ).length

    // Count events (check if trainer has schedule during event period)
    const eventCount = events.filter((event: any) => {
      const eventStart = new Date(event.start_date)
      const eventEnd = new Date(event.end_date)
      // Check if trainer has any schedule entries during this event
      return schedules.some((schedule: any) => {
        const scheduleDate = new Date(schedule.date)
        return scheduleDate >= eventStart && scheduleDate <= eventEnd
      })
    }).length

    // Count physical training
    const physical = physicalTraining.filter((training: any) =>
      training.in_charge === trainer?.name || 
      training.participants.includes(selectedTrainer)
    ).length

    // Count leadership roles (where trainer is in_charge)
    const leadership = 
      religiousActivities.filter((a: any) => a.in_charge === trainer?.name).length +
      physicalTraining.filter((t: any) => t.in_charge === trainer?.name).length

    return { religious, events: eventCount, physical, leadership }
  }

  // Get activities for a specific date
  const getActivitiesForDate = (day: number) => {
    if (!selectedTrainer) return []

    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const activities: any[] = []

    // Check religious activities
    religiousActivities.forEach((activity: any) => {
      if (activity.date === dateStr) {
        if (activity.in_charge === trainer?.name) {
          activities.push({
            type: 'Religious Activity',
            time: 'Morning',
            activity: activity.activity,
            role: 'Leader/Imam',
            color: '#22c55e'
          })
        } else if (activity.participants.includes(selectedTrainer)) {
          activities.push({
            type: 'Religious Activity',
            time: 'Morning',
            activity: activity.activity,
            role: 'Participant',
            color: '#86efac'
          })
        }
      }
    })

    // Check events
    events.forEach((event: any) => {
      const eventStart = new Date(event.start_date)
      const eventEnd = new Date(event.end_date)
      const checkDate = new Date(dateStr)
      
      if (checkDate >= eventStart && checkDate <= eventEnd) {
        activities.push({
          type: 'Event',
          time: 'Full Day',
          activity: event.name,
          role: 'Participant',
          color: event.color || '#3b82f6'
        })
      }
    })

    // Check physical training
    physicalTraining.forEach((training: any) => {
      if (training.date === dateStr) {
        if (training.in_charge === trainer?.name) {
          activities.push({
            type: 'Physical Training',
            time: training.time_slot || '5:00 PM - 7:00 PM',
            activity: training.training_type,
            role: 'In Charge',
            color: '#f97316'
          })
        } else if (training.participants.includes(selectedTrainer)) {
          activities.push({
            type: 'Physical Training',
            time: training.time_slot || '5:00 PM - 7:00 PM',
            activity: training.training_type,
            role: 'Participant',
            color: '#fdba74'
          })
        }
      }
    })

    return activities
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

  const summary = getMonthlySummary()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Trainer Activity Overview</h1>
        <p className="text-gray-600">Comprehensive Trainer Schedule Monitoring</p>
      </div>

      {/* Control Panel */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Trainer Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Select Trainer
            </label>
            <select
              value={selectedTrainer || ''}
              onChange={(e) => handleTrainerChange(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a Trainer</option>
              {trainers.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.rank} {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month/Year Navigation */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Month & Year
            </label>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleMonthChange('prev')}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition"
              >
                ◀
              </button>
              <div className="flex-1 text-center font-semibold text-lg">
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <button
                onClick={() => handleMonthChange('next')}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition"
              >
                ▶
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedTrainer && trainer ? (
        <>
          {/* Monthly Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4 text-center">
              Monthly Summary for {trainer.rank} {trainer.name}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                title="Religious Activities"
                value={summary.religious}
                icon="🕌"
                color="bg-teal-500"
              />
              <SummaryCard
                title="Event Details"
                value={summary.events}
                icon="📅"
                color="bg-blue-500"
              />
              <SummaryCard
                title="Physical Training"
                value={summary.physical}
                icon="💪"
                color="bg-orange-500"
              />
              <SummaryCard
                title="Leadership Roles"
                value={summary.leadership}
                icon="⭐"
                color="bg-yellow-500"
              />
            </div>
          </div>

          {/* Calendar View */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Calendar</h3>
            
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                <div 
                  key={day} 
                  className={`text-center font-semibold py-2 ${
                    idx === 5 ? 'text-teal-700' : 'text-gray-700'
                  }`}
                >
                  {day}
                  {idx === 5 && <span className="ml-1">🕌</span>}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {getDaysInMonth().map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="aspect-square" />
                }

                const dayActivities = getActivitiesForDate(day)
                const isToday = 
                  day === new Date().getDate() &&
                  currentDate.getMonth() === new Date().getMonth() &&
                  currentDate.getFullYear() === new Date().getFullYear()

                const dateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
                const isFriday = dateObj.getDay() === 5
                const isSelectedDate = selectedDate?.getDate() === day &&
                  selectedDate?.getMonth() === currentDate.getMonth() &&
                  selectedDate?.getFullYear() === currentDate.getFullYear()

                return (
                  <div
                    key={day}
                    onClick={() => {
                      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
                      setSelectedDate(date)
                    }}
                    className={`
                      aspect-square border-2 rounded-lg p-2 cursor-pointer transition-all
                      hover:shadow-lg hover:scale-105
                      ${isToday ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-300' : 
                        isFriday ? 'border-teal-400 bg-teal-50' :
                        isSelectedDate ? 'border-purple-600 bg-purple-50' :
                        'border-gray-200 bg-white'}
                    `}
                  >
                    <div className={`font-semibold mb-1 text-sm ${
                      isToday ? 'text-blue-700' : 
                      isFriday ? 'text-teal-700' :
                      isSelectedDate ? 'text-purple-700' :
                      'text-gray-900'
                    }`}>
                      {day}
                    </div>
                    
                    <div className="space-y-1">
                      {dayActivities.slice(0, 2).map((activity: any, idx: number) => (
                        <div
                          key={idx}
                          className="text-xs px-1 py-0.5 rounded truncate"
                          style={{ backgroundColor: activity.color + '20', color: activity.color }}
                          title={`${activity.activity} (${activity.role})`}
                        >
                          {activity.type === 'Religious Activity' ? '🕌' :
                           activity.type === 'Physical Training' ? '💪' : '📅'}
                        </div>
                      ))}
                      {dayActivities.length > 2 && (
                        <div className="text-xs text-gray-600 font-medium">
                          +{dayActivities.length - 2}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="mt-6 pt-4 border-t">
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-600 bg-blue-50 rounded"></div>
                  <span>Today</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 border-2 border-purple-600 bg-purple-50 rounded"></div>
                  <span>Selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 border-2 border-teal-400 bg-teal-50 rounded"></div>
                  <span>Friday 🕌</span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Schedule Details */}
          {selectedDate && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                Daily Schedule for {trainer.rank} {trainer.name} - {' '}
                {selectedDate.toLocaleDateString('en-US', { 
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </h3>

              {(() => {
                const activities = getActivitiesForDate(selectedDate.getDate())
                
                if (activities.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-500">
                      <p className="text-lg">No activities scheduled for this day</p>
                      <p className="text-sm mt-2">This trainer is free on this date</p>
                    </div>
                  )
                }

                return (
                  <div className="space-y-3">
                    {activities.map((activity: any, idx: number) => (
                      <div
                        key={idx}
                        className="border-l-4 p-4 rounded-r-lg"
                        style={{ 
                          borderLeftColor: activity.color,
                          backgroundColor: activity.color + '10'
                        }}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-2xl">
                                {activity.type === 'Religious Activity' ? '🕌' :
                                 activity.type === 'Physical Training' ? '💪' : '📅'}
                              </span>
                              <h4 className="font-semibold text-gray-900 text-lg">
                                {activity.activity}
                              </h4>
                            </div>
                            <div className="space-y-1 text-sm text-gray-700">
                              <p><strong>Type:</strong> {activity.type}</p>
                              <p><strong>Time:</strong> {activity.time}</p>
                              <p><strong>Role:</strong> {activity.role}</p>
                            </div>
                          </div>
                          <div 
                            className="text-xs px-3 py-1 rounded-full text-white font-semibold"
                            style={{ backgroundColor: activity.color }}
                          >
                            {activity.role}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Daily Summary */}
              <div className="mt-6 pt-4 border-t">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {getActivitiesForDate(selectedDate.getDate()).length}
                    </div>
                    <div className="text-sm text-gray-600">Total Activities</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {getActivitiesForDate(selectedDate.getDate()).filter(a => a.role.includes('In Charge') || a.role.includes('Leader')).length}
                    </div>
                    <div className="text-sm text-gray-600">Leadership Roles</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {getActivitiesForDate(selectedDate.getDate()).filter(a => a.role === 'Participant').length}
                    </div>
                    <div className="text-sm text-gray-600">Participations</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-2xl font-semibold text-gray-900 mb-2">
            Select a Trainer
          </h3>
          <p className="text-gray-600">
            Choose a trainer from the dropdown above to view their activity overview and schedule
          </p>
        </div>
      )}
    </div>
  )
}

// Summary Card Component
function SummaryCard({ 
  title, 
  value, 
  icon, 
  color 
}: { 
  title: string
  value: number
  icon: string
  color: string
}) {
  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`${color} text-white p-3 rounded-lg text-2xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}