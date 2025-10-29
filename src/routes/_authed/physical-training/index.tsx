import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server functions
const getPhysicalTrainingData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')
    .order('name')

  const { data: trainingSessions } = await supabase
    .from('physical_training')
    .select('*')
    .order('date', { ascending: true })

  // Calculate stats
  const today = new Date().toISOString().split('T')[0]
  const todayTrainings = trainingSessions?.filter(t => t.date === today) || []
  
  // Get this week's trainings
  const startOfWeek = new Date()
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)
  startOfWeek.setHours(0, 0, 0, 0)
  
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  endOfWeek.setHours(23, 59, 59, 999)
  
  const thisWeekTrainings = trainingSessions?.filter(t => {
    const trainingDate = new Date(t.date)
    return trainingDate >= startOfWeek && trainingDate <= endOfWeek
  }) || []

  return {
    trainers: trainers || [],
    trainingSessions: trainingSessions || [],
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todayTrainings.length,
      thisWeekSessions: thisWeekTrainings.length,
    }
  }
})

const createTraining = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    date: string
    training_type: string
    in_charge: string
    participants: number[]
    time_slot: string
  }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    
    const { error } = await supabase
      .from('physical_training')
      .insert([data])

    if (error) {
      return { error: error.message }
    }

    return { success: true }
  })

const TRAINING_TYPES = [
  'Physical Fitness Training',
  'Combat Drills',
  'Agility Exercises',
  'Endurance Training',
  'Strength Conditioning',
  'Flexibility Sessions',
  'Safety Equipment Inspection',
  'Emergency Response Drill',
  'Team Building Workshop',
]

const TIME_SLOTS = [
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
]

export const Route = createFileRoute('/_authed/physical-training/')({
  loader: async () => await getPhysicalTrainingData(),
  component: PhysicalTrainingPage,
})

function PhysicalTrainingPage() {
  const { trainers, trainingSessions, stats } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [view, setView] = useState<'week' | 'month' | 'trainer-schedule'>('month')
  const [selectedTrainer, setSelectedTrainer] = useState<string>('all')

  // Get trainings for a specific date
  const getTrainingsForDate = (day: number, month?: number, year?: number) => {
    const m = month ?? currentDate.getMonth()
    const y = year ?? currentDate.getFullYear()
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return trainingSessions.filter((t: any) => t.date === dateStr)
  }

  // Get today's trainings
  const getTodayTrainings = () => {
    const today = new Date()
    return getTrainingsForDate(today.getDate(), today.getMonth(), today.getFullYear())
  }

  // Get this week's trainings
  const getWeekTrainings = () => {
    const startOfWeek = new Date(currentDate)
    const day = startOfWeek.getDay()
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
    startOfWeek.setDate(diff)
    
    const trainings: any[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek)
      date.setDate(startOfWeek.getDate() + i)
      const dayTrainings = getTrainingsForDate(date.getDate(), date.getMonth(), date.getFullYear())
      trainings.push(...dayTrainings.map(t => ({ ...t, displayDate: date })))
    }
    return trainings
  }

  // Get trainings for selected trainer
  const getTrainerTrainings = () => {
    if (selectedTrainer === 'all') {
      return trainingSessions
    }
    return trainingSessions.filter((t: any) => 
      t.in_charge === selectedTrainer || t.participants.some((p: number) => {
        const trainer = trainers.find((tr: any) => tr.id === p)
        return trainer?.name === selectedTrainer
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
    
    // Empty cells before month starts
    for (let i = 0; i < startDay; i++) {
      days.push(null)
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }
    
    return days
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Physical Training Schedule</h1>
        <p className="text-gray-600">Schedule after-hours physical activities (5:00 PM - 7:00 PM)</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Active Trainers" 
          value={stats.activeTrainers} 
          icon="💪" 
          color="bg-orange-500"
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
                view === 'week' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded transition ${
                view === 'month' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView('trainer-schedule')}
              className={`px-4 py-2 rounded transition ${
                view === 'trainer-schedule' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
              }`}
            >
              Trainer Schedule
            </button>
          </div>
        </div>
      </div>

      {/* Conditional View Rendering */}
      {view === 'month' && (
        <MonthView 
          getDaysInMonth={getDaysInMonth}
          getTrainingsForDate={getTrainingsForDate}
          handleDateClick={handleDateClick}
          currentDate={currentDate}
        />
      )}

      {view === 'week' && (
        <WeekView 
          trainingSessions={getWeekTrainings()}
          currentDate={currentDate}
          trainers={trainers}
        />
      )}

      {view === 'trainer-schedule' && (
        <TrainerScheduleView 
          trainers={trainers}
          trainingSessions={getTrainerTrainings()}
          selectedTrainer={selectedTrainer}
          setSelectedTrainer={setSelectedTrainer}
          currentDate={currentDate}
        />
      )}

      {/* Always Show Training Events List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">
          {view === 'week' ? 'This Week\'s Training Events' : 
           view === 'trainer-schedule' ? 'Trainer\'s Training Events' :
           'Today\'s Training Events'}
        </h3>
        
        {(() => {
          const displayTrainings = view === 'week' ? getWeekTrainings() : 
                                   view === 'trainer-schedule' ? getTrainerTrainings() :
                                   getTodayTrainings()
          
          if (displayTrainings.length === 0) {
            return <p className="text-gray-600">No training scheduled</p>
          }

          return (
            <div className="space-y-3">
              {displayTrainings.map((training: any) => (
                <div key={training.id} className="border-l-4 border-orange-500 bg-orange-50 p-4 rounded hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{training.training_type}</h4>
                      {training.displayDate && (
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Date:</strong> {training.displayDate.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      )}
                      <p className="text-sm text-gray-600 mt-1">
                        <strong>In Charge:</strong> {training.in_charge}
                      </p>
                      <p className="text-sm text-gray-600">
                        <strong>Participants:</strong> {training.participants.length} trainer(s)
                      </p>
                      <p className="text-sm text-gray-600">
                        <strong>Time:</strong> {training.time_slot}
                      </p>
                    </div>
                    <div className="text-xs bg-orange-200 text-orange-800 px-3 py-1 rounded-full">
                      💪 Physical
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
        <AssignmentModal
          date={selectedDate}
          trainers={trainers}
          onClose={() => setShowModal(false)}
          onSubmit={createTraining}
        />
      )}
    </div>
  )
}

// Stat Card Component
function StatCard({ title, value, icon, color }: { 
  title: string
  value: number
  icon: string
  color: string
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
  getTrainingsForDate, 
  handleDateClick,
  currentDate 
}: {
  getDaysInMonth: () => (number | null)[]
  getTrainingsForDate: (day: number) => any[]
  handleDateClick: (day: number) => void
  currentDate: Date
}) {
  return (
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

          const trainings = getTrainingsForDate(day)
          const isToday = 
            day === new Date().getDate() &&
            currentDate.getMonth() === new Date().getMonth() &&
            currentDate.getFullYear() === new Date().getFullYear()

          return (
            <div
              key={day}
              onClick={() => handleDateClick(day)}
              className={`
                aspect-square border-2 rounded-lg p-2 cursor-pointer transition-all
                hover:shadow-lg hover:border-orange-500 hover:scale-105
                ${isToday ? 'border-orange-600 bg-orange-50' : 'border-gray-200 bg-white'}
              `}
            >
              <div className={`font-semibold mb-1 ${isToday ? 'text-orange-600' : 'text-gray-900'}`}>
                {day}
              </div>
              
              {/* Training indicators */}
              <div className="space-y-1">
                {trainings.slice(0, 2).map((training: any, idx: number) => (
                  <div
                    key={idx}
                    className="bg-orange-100 text-orange-800 text-xs p-1 rounded truncate"
                    title={training.training_type}
                  >
                    💪 {training.training_type.substring(0, 8)}...
                  </div>
                ))}
                {trainings.length > 2 && (
                  <div className="text-xs text-gray-600 font-medium">
                    +{trainings.length - 2} more
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

// Week View Component
function WeekView({ 
  trainingSessions, 
  currentDate,
  trainers 
}: { 
  trainingSessions: any[]
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
          const dayTrainings = trainingSessions.filter((t: any) => t.date === dateStr)
          
          const isToday = date.toDateString() === new Date().toDateString()
          
          return (
            <div key={day} className={`text-center p-3 rounded-lg ${isToday ? 'bg-orange-50' : ''}`}>
              <div className={`font-semibold ${isToday ? 'text-orange-600' : 'text-gray-700'}`}>
                {day}
              </div>
              <div className={`text-2xl font-bold mt-2 ${isToday ? 'text-orange-600' : 'text-gray-900'}`}>
                {date.getDate()}
              </div>
              <div className="mt-4 space-y-2">
                {dayTrainings.map((training: any) => (
                  <div 
                    key={training.id} 
                    className="bg-orange-100 text-orange-800 text-xs p-2 rounded border-l-4 border-orange-500"
                  >
                    <div className="font-semibold truncate">{training.training_type}</div>
                    <div className="text-xs mt-1">{training.time_slot}</div>
                    <div className="text-xs">👤 {training.in_charge}</div>
                  </div>
                ))}
                {dayTrainings.length === 0 && (
                  <div className="text-xs text-gray-400 italic">No training</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Trainer Schedule View Component
function TrainerScheduleView({ 
  trainers, 
  trainingSessions,
  selectedTrainer,
  setSelectedTrainer,
  currentDate
}: {
  trainers: any[]
  trainingSessions: any[]
  selectedTrainer: string
  setSelectedTrainer: (trainer: string) => void
  currentDate: Date
}) {
  return (
    <div className="space-y-6">
      {/* Trainer Selector */}
      <div className="bg-white rounded-lg shadow p-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Select Trainer
        </label>
        <select
          value={selectedTrainer}
          onChange={(e) => setSelectedTrainer(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
        >
          <option value="all">All Trainers</option>
          {trainers.map(trainer => (
            <option key={trainer.id} value={trainer.name}>
              {trainer.rank} {trainer.name}
            </option>
          ))}
        </select>
      </div>

      {/* Trainer Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Sessions</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {trainingSessions.length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">This Month</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {trainingSessions.filter((t: any) => {
              const trainingDate = new Date(t.date)
              return trainingDate.getMonth() === currentDate.getMonth() &&
                     trainingDate.getFullYear() === currentDate.getFullYear()
            }).length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">As Lead Trainer</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {trainingSessions.filter((t: any) => t.in_charge === selectedTrainer).length}
          </div>
        </div>
      </div>

      {/* Active Trainers List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Active Trainers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map(trainer => {
            const trainerSessions = trainingSessions.filter((t: any) => 
              t.in_charge === trainer.name || t.participants.includes(trainer.id)
            )
            
            return (
              <div 
                key={trainer.id} 
                className={`p-4 rounded-lg border-2 transition cursor-pointer ${
                  selectedTrainer === trainer.name 
                    ? 'border-orange-500 bg-orange-50' 
                    : 'border-gray-200 hover:border-orange-300'
                }`}
                onClick={() => setSelectedTrainer(trainer.name)}
              >
                <div className="flex items-center space-x-3">
                  <div className="bg-orange-100 text-orange-800 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold">
                    {trainer.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{trainer.name}</div>
                    <div className="text-sm text-gray-600">{trainer.rank}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {trainerSessions.length} session(s)
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

// Assignment Modal Component
function AssignmentModal({ 
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
    training_type: TRAINING_TYPES[0],
    in_charge: trainers[0]?.name || '',
    participants: [] as number[],
    time_slot: TIME_SLOTS[0],
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
      window.location.reload() // Refresh to show new training
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
          <div className="bg-green-50 border-b px-6 py-4 flex justify-between items-center sticky top-0">
            <h3 className="text-xl font-semibold text-gray-900">
              Assign Physical Training
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
                  day: 'numeric'
                })}
                readOnly
                className="w-full px-4 py-2 border rounded-lg bg-gray-50"
              />
            </div>

            {/* Training Type */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Training Type *
              </label>
              <select
                required
                value={formData.training_type}
                onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {TRAINING_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Time Slot */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Time Slot *
              </label>
              <select
                required
                value={formData.time_slot}
                onChange={(e) => setFormData({ ...formData, time_slot: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {TIME_SLOTS.map(slot => (
                  <option key={slot} value={slot}>{slot}</option>
                ))}
              </select>
            </div>

            {/* In Charge */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Trainer in Charge *
              </label>
              <select
                required
                value={formData.in_charge}
                onChange={(e) => setFormData({ ...formData, in_charge: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {trainers.map(trainer => (
                  <option key={trainer.id} value={trainer.name}>
                    {trainer.rank} {trainer.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Participating Trainers */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Participating Trainers *
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
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm">
                      <span className="font-medium">{trainer.rank}</span> {trainer.name}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Selected: {formData.participants.length} trainer(s)
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
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Assigning...' : 'Assign Training'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}