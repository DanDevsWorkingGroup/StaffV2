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

  return {
    activities: activities || [],
    trainers: trainers || []
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
  'Islamic Studies',
  'Quran Recitation',
  'Religious Lecture',
  'Community Prayer',
]

export const Route = createFileRoute('/_authed/trainer-overview/')({
  loader: async () => await getReligiousActivityData(),
  component: ReligiousActivityPage,
})

function ReligiousActivityPage() {
  const { activities, trainers } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [view, setView] = useState<'calendar' | 'list'>('calendar')

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

  // Get activities for a specific date
  const getActivitiesForDate = (day: number) => {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return activities.filter((a: any) => a.date === dateStr)
  }

  const handleDateClick = (day: number) => {
    const selected = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    setSelectedDate(selected)
    setShowModal(true)
  }

  // Calculate statistics
  const thisMonthActivities = activities.filter((a: any) => {
    const actDate = new Date(a.date)
    return actDate.getMonth() === currentDate.getMonth() && 
           actDate.getFullYear() === currentDate.getFullYear()
  })

  const todayActivities = activities.filter((a: any) => {
    const today = new Date().toISOString().split('T')[0]
    return a.date === today
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Religious Activities Schedule</h1>
        <p className="text-gray-600">Schedule spiritual guidance and community building activities</p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Today's Activities" 
          value={todayActivities.length} 
          icon="📖" 
          color="bg-green-500"
        />
        <StatCard 
          title="This Month" 
          value={thisMonthActivities.length} 
          icon="📅" 
          color="bg-blue-500"
        />
        <StatCard 
          title="Active Participants" 
          value={trainers.length} 
          icon="👥" 
          color="bg-purple-500"
        />
      </div>

      {/* View Toggle and Navigation */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          {/* Month Navigation */}
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() - 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
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
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              ▶
            </button>
          </div>

          {/* View Toggle */}
          <div className="flex space-x-2">
            <button
              onClick={() => setView('calendar')}
              className={`px-4 py-2 rounded-lg ${
                view === 'calendar' ? 'bg-purple-600 text-white' : 'bg-gray-200'
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-4 py-2 rounded-lg ${
                view === 'list' ? 'bg-purple-600 text-white' : 'bg-gray-200'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Calendar or List View */}
      {view === 'calendar' ? (
        <div className="bg-white rounded-lg shadow p-6">
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center font-semibold text-gray-700 py-2">
                {day}
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
                    aspect-square border-2 rounded-lg p-2 cursor-pointer transition
                    hover:shadow-lg hover:border-purple-500
                    ${isToday ? 'border-purple-600 bg-purple-50' : 
                      isFriday ? 'border-green-300 bg-green-50' : 'border-gray-200'}
                  `}
                >
                  <div className={`font-semibold mb-1 flex items-center justify-between ${
                    isToday ? 'text-purple-600' : 'text-gray-900'
                  }`}>
                    <span>{day}</span>
                    {isFriday && <span className="text-xs">🕌</span>}
                  </div>
                  
                  {/* Activity indicators */}
                  <div className="space-y-1">
                    {dayActivities.slice(0, 2).map((activity: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-teal-100 text-teal-800 text-xs p-1 rounded truncate"
                        title={activity.activity}
                      >
                        📖 {activity.activity.substring(0, 8)}
                      </div>
                    ))}
                    {dayActivities.length > 2 && (
                      <div className="text-xs text-gray-600">
                        +{dayActivities.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <h3 className="text-xl font-semibold mb-4">Upcoming Activities</h3>
            {thisMonthActivities.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📖</div>
                <p className="text-gray-600">No activities scheduled for this month</p>
              </div>
            ) : (
              <div className="space-y-3">
                {thisMonthActivities.map((activity: any) => (
                  <ActivityCard key={activity.id} activity={activity} trainers={trainers} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <div className={`${color} w-16 h-16 rounded-full flex items-center justify-center text-3xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// Activity Card Component
function ActivityCard({ activity, trainers }: { activity: any; trainers: any[] }) {
  const actDate = new Date(activity.date)
  const participantNames = activity.participants.map((id: number) => {
    const trainer = trainers.find(t => t.id === id)
    return trainer?.name || 'Unknown'
  })

  return (
    <div className="border-l-4 border-teal-500 bg-teal-50 p-4 rounded">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-semibold text-gray-900 text-lg">{activity.activity}</h4>
          <p className="text-sm text-gray-600 mt-1">
            📅 {actDate.toLocaleDateString('en-US', { 
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            <strong>Leader/Imam:</strong> {activity.in_charge}
          </p>
          <p className="text-sm text-gray-600">
            <strong>Participants:</strong> {activity.participants.length} trainers
          </p>
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="bg-teal-50 border-b px-6 py-4 flex justify-between items-center sticky top-0">
          <h3 className="text-xl font-semibold text-gray-900">
            Schedule Religious Activity
          </h3>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-2xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
  )
}