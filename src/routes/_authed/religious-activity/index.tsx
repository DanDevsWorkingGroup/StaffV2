import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

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

  return {
    activities: activities || [],
    trainers: trainers || [],
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
  const { activities, trainers, stats } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [view, setView] = useState<'week' | 'month' | 'participant-schedule'>('month')
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all')

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
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() - 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              ◀ Previous
            </button>
            
            <h2 className="text-2xl font-bold">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() + 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              Next ▶
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => setView('week')}
              className={`px-4 py-2 rounded transition ${
                view === 'week' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded transition ${
                view === 'month' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView('participant-schedule')}
              className={`px-4 py-2 rounded transition ${
                view === 'participant-schedule' ? 'bg-teal-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Participant Schedule
            </button>
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

      {view === 'participant-schedule' && (
        <ParticipantScheduleView 
          trainers={trainers}
          activities={getParticipantActivities()}
          selectedParticipant={selectedParticipant}
          setSelectedParticipant={setSelectedParticipant}
          currentDate={currentDate}
        />
      )}

      {/* Always Show Activity List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">
          {view === 'week' ? 'This Week\'s Religious Activities' : 
           view === 'participant-schedule' ? 'Participant\'s Activities' :
           'Today\'s Religious Activities'}
        </h3>
        
        {(() => {
          const displayActivities = view === 'week' ? getWeekActivities() : 
                                   view === 'participant-schedule' ? getParticipantActivities() :
                                   getTodayActivities()
          
          if (displayActivities.length === 0) {
            return <p className="text-gray-600">No activities scheduled</p>
          }

          return (
            <div className="space-y-3">
              {displayActivities.map((activity: any) => (
                <div key={activity.id} className="border-l-4 border-teal-500 bg-teal-50 p-4 rounded hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 text-lg">{activity.activity}</h4>
                      {activity.displayDate && (
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Date:</strong> {activity.displayDate.toLocaleDateString('en-US', { 
                            weekday: 'long',
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      )}
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
                </div>
              ))}
            </div>
          )
        })()}
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

// Month View Component
function MonthView({ 
  getDaysInMonth, 
  getActivitiesForDate, 
  handleDateClick,
  currentDate 
}: {
  getDaysInMonth: () => (number | null)[]
  getActivitiesForDate: (day: number) => any[]
  handleDateClick: (day: number) => void
  currentDate: Date
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-2 mb-4">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
          <div 
            key={day} 
            className={`text-center font-semibold py-2 ${
              idx === 5 ? 'text-green-700' : 'text-gray-700'
            }`}
          >
            {day}
            {idx === 5 && <span className="ml-1">🕌</span>}
          </div>
        ))}
      </div>

      {/* Calendar Days */}
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

          // Check if it's Friday (Jummah)
          const dateObj = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
          const isFriday = dateObj.getDay() === 5

          return (
            <div
              key={day}
              onClick={() => handleDateClick(day)}
              className={`
                aspect-square border-2 rounded-lg p-2 cursor-pointer transition-all
                hover:shadow-lg hover:border-teal-500 hover:scale-105
                ${isToday ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-300' : 
                  isFriday ? 'border-green-400 bg-green-50' : 
                  'border-gray-200 bg-white'}
              `}
            >
              <div className={`font-semibold mb-1 flex items-center justify-between ${
                isToday ? 'text-teal-700' : 
                isFriday ? 'text-green-700' : 
                'text-gray-900'
              }`}>
                <span>{day}</span>
                {isFriday && <span className="text-xs">🕌</span>}
              </div>
              
              {/* Activity indicators */}
              <div className="space-y-1">
                {dayActivities.slice(0, 2).map((activity: any, idx: number) => (
                  <div
                    key={idx}
                    className={`text-xs p-1 rounded truncate ${
                      activity.activity.includes('Prayer') || activity.activity.includes('Jummah')
                        ? 'bg-green-100 text-green-800'
                        : 'bg-teal-100 text-teal-800'
                    }`}
                    title={activity.activity}
                  >
                    🕌 {activity.activity.substring(0, 8)}...
                  </div>
                ))}
                {dayActivities.length > 2 && (
                  <div className="text-xs text-gray-600 font-medium">
                    +{dayActivities.length - 2} more
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
            <div className="w-6 h-6 border-2 border-teal-600 bg-teal-50 rounded"></div>
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 border-2 border-green-400 bg-green-50 rounded"></div>
            <span>Friday (Jummah) 🕌</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-green-100 border border-green-300 rounded"></div>
            <span>Prayer Activity</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-teal-100 border border-teal-300 rounded"></div>
            <span>Other Activity</span>
          </div>
        </div>
      </div>
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

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          const date = weekDates[idx]
          const dateStr = date.toISOString().split('T')[0]
          const dayActivities = activities.filter((a: any) => a.date === dateStr)
          
          const isToday = date.toDateString() === new Date().toDateString()
          const isFriday = date.getDay() === 5
          
          return (
            <div 
              key={day} 
              className={`text-center p-3 rounded-lg ${
                isToday ? 'bg-teal-50 ring-2 ring-teal-300' : 
                isFriday ? 'bg-green-50' : ''
              }`}
            >
              <div className={`font-semibold ${
                isToday ? 'text-teal-600' : 
                isFriday ? 'text-green-600' : 
                'text-gray-700'
              }`}>
                {day}
                {isFriday && <span className="ml-1">🕌</span>}
              </div>
              <div className={`text-2xl font-bold mt-2 ${
                isToday ? 'text-teal-600' : 
                isFriday ? 'text-green-600' : 
                'text-gray-900'
              }`}>
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
  return (
    <div className="space-y-6">
      {/* Participant Selector */}
      <div className="bg-white rounded-lg shadow p-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Select Participant
        </label>
        <select
          value={selectedParticipant}
          onChange={(e) => setSelectedParticipant(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All Participants</option>
          {trainers.map(trainer => (
            <option key={trainer.id} value={trainer.name}>
              {trainer.rank} {trainer.name}
            </option>
          ))}
        </select>
      </div>

      {/* Participant Statistics */}
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
          <div className="text-sm text-gray-600">As Leader/Imam</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {activities.filter((a: any) => a.in_charge === selectedParticipant).length}
          </div>
        </div>
      </div>

      {/* Active Participants List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Active Participants</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map(trainer => {
            const participantActivities = activities.filter((a: any) => 
              a.in_charge === trainer.name || a.participants.includes(trainer.id)
            )
            
            return (
              <div 
                key={trainer.id} 
                className={`p-4 rounded-lg border-2 transition cursor-pointer ${
                  selectedParticipant === trainer.name 
                    ? 'border-teal-500 bg-teal-50' 
                    : 'border-gray-200 hover:border-teal-300'
                }`}
                onClick={() => setSelectedParticipant(trainer.name)}
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
      </div>
    </div>
  )
}

// Activity Modal Component
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

  const isFriday = date.getDay() === 5

  return (
    <>
      {/* Modal Backdrop - separate from modal content */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto pointer-events-auto">
          {/* Modal Header */}
          <div className={`border-b px-6 py-4 flex justify-between items-center sticky top-0 ${
            isFriday ? 'bg-green-50' : 'bg-teal-50'
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

            {/* Participants */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Participants *
              </label>
              <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                {trainers.map(trainer => (
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
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Selected: {formData.participants.length} participant(s)
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