import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { getCurrentUserRole, resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState, useMemo } from 'react'
import { MonthCalendar, type CalItem } from '~/components/mobile'

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

  // Filter for TRAINER role
  const user = await getCurrentUserRole()
  let visibleTrainingSessions = trainingSessions || []

  if (user?.role === 'TRAINER') {
    visibleTrainingSessions = visibleTrainingSessions.filter((session: any) =>
      session.in_charge === user.name ||
      session.participants.includes(user.trainerId)
    )
  }

  // Recalculate stats for trainer view
  if (user?.role === 'TRAINER') {
    const todayTrainingsFiltered = visibleTrainingSessions.filter(t => t.date === today)
    const thisWeekTrainingsFiltered = visibleTrainingSessions.filter(t => {
      const trainingDate = new Date(t.date)
      return trainingDate >= startOfWeek && trainingDate <= endOfWeek
    })

    return {
      trainers: trainers || [],
      trainingSessions: visibleTrainingSessions,
      stats: {
        activeTrainers: trainers?.length || 0,
        todaySessions: todayTrainingsFiltered.length,
        thisWeekSessions: thisWeekTrainingsFiltered.length,
      },
      user  // FIXED: Return user for RBAC checks
    }
  }

  return {
    trainers: trainers || [],
    trainingSessions: trainingSessions || [],
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todayTrainings.length,
      thisWeekSessions: thisWeekTrainings.length,
    },
    user  // FIXED: Return user for RBAC checks
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
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'])

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
  const { trainers, trainingSessions, stats, user } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [view, setView] = useState<'week' | 'month' | 'trainer-schedule'>('month')
  const [selectedTrainer, setSelectedTrainer] = useState<string>('all')
  // FIXED: RBAC - Only ADMIN, COORDINATOR, and PT COORDINATOR can create PT sessions
  const canCreatePT = user?.role && ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'].includes(user.role)

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
    // FIXED: RBAC check - Only PT Coordinators can create
    if (!canCreatePT) {
      alert('Unauthorized: Only PT Coordinators and Admins can create physical training sessions')
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
          {/* Navigation - Smart Month/Week Navigation */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                // ✅ FIXED: Check view type
                if (view === 'week' || view === 'trainer-schedule') {
                  // Move backward by 7 days (1 week)
                  newDate.setDate(currentDate.getDate() - 7)
                } else {
                  // Move backward by 1 month
                  newDate.setMonth(currentDate.getMonth() - 1)
                }
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              ◀ Previous
            </button>

            <h2 className="text-2xl font-bold text-gray-900">
              {view === 'week' || view === 'trainer-schedule'
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
                if (view === 'week' || view === 'trainer-schedule') {
                  // Move forward by 7 days (1 week)
                  newDate.setDate(currentDate.getDate() + 7)
                } else {
                  // Move forward by 1 month
                  newDate.setMonth(currentDate.getMonth() + 1)
                }
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
              className={`px-4 py-2 rounded transition ${view === 'week' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded transition ${view === 'month' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                }`}
            >
              Month
            </button>
            <button
              onClick={() => setView('trainer-schedule')}
              className={`px-4 py-2 rounded transition ${view === 'trainer-schedule' ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
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
                <Link
                  key={training.id}
                  to="/physical-training/$id"
                  params={{ id: training.id.toString() }}
                  className="block border-l-4 border-orange-500 bg-orange-50 p-4 rounded hover:shadow-lg hover:bg-orange-100 transition-all cursor-pointer"
                >
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
                </Link>
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
  getTrainingsForDate,
  handleDateClick,
  currentDate
}: {
  getDaysInMonth: () => (number | null)[]
  getTrainingsForDate: (day: number) => any[]
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
        onDayClick={readOnly ? undefined : handleDateClick}
        getItems={(day) =>
          getTrainingsForDate(day).map((t: any, idx: number): CalItem => ({
            key: idx,
            label: `💪 ${t.training_type}`,
            color: '#ea580c',
            onClick: readOnly ? undefined : () => handleDateClick(day),
          }))
        }
      />
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
                className={`p-4 rounded-lg border-2 transition cursor-pointer ${selectedTrainer === trainer.name
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

// Assignment Modal Component with Enhanced Filtering
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

  // ENHANCED: Search and filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRank, setSelectedRank] = useState<string>('all')
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [selectedSpecialization, setSelectedSpecialization] = useState<string>('all')

  // Get unique values for filters
  const { ranks, departments, specializations } = useMemo(() => {
    const ranksSet = new Set<string>()
    const departmentsSet = new Set<string>()
    const specializationsSet = new Set<string>()

    trainers.forEach((trainer: any) => {
      if (trainer.rank) ranksSet.add(trainer.rank)
      if (trainer.department) departmentsSet.add(trainer.department)
      if (trainer.specialization) specializationsSet.add(trainer.specialization)
    })

    return {
      ranks: Array.from(ranksSet).sort(),
      departments: Array.from(departmentsSet).sort(),
      specializations: Array.from(specializationsSet).sort(),
    }
  }, [trainers])

  // Filtered trainers based on search and filters
  const filteredTrainers = useMemo(() => {
    return trainers.filter((trainer: any) => {
      const matchesSearch = 
        trainer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        trainer.ic_number?.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesRank = selectedRank === 'all' || trainer.rank === selectedRank
      const matchesDepartment = selectedDepartment === 'all' || trainer.department === selectedDepartment
      const matchesSpecialization = selectedSpecialization === 'all' || trainer.specialization === selectedSpecialization

      return matchesSearch && matchesRank && matchesDepartment && matchesSpecialization
    })
  }, [trainers, searchTerm, selectedRank, selectedDepartment, selectedSpecialization])

  // Get selected trainers data
  const selectedTrainers = useMemo(() => {
    return trainers.filter((t: any) => formData.participants.includes(t.id))
  }, [trainers, formData.participants])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (formData.participants.length === 0) {
      alert('Please select at least one participating trainer')
      return
    }
    
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

  // Select all filtered trainers
  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredTrainers.map((t: any) => t.id)
    setFormData(prev => ({
      ...prev,
      participants: [...new Set([...prev.participants, ...allFilteredIds])]
    }))
  }

  // Deselect all trainers
  const handleDeselectAll = () => {
    setFormData(prev => ({
      ...prev,
      participants: []
    }))
  }

  // Clear all filters
  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedRank('all')
    setSelectedDepartment('all')
    setSelectedSpecialization('all')
  }

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
          <div className="bg-green-50 border-b px-6 py-4 flex justify-between items-center sticky top-0 z-10">
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
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
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
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                {TIME_SLOTS.map(slot => (
                  <option key={slot} value={slot}>{slot}</option>
                ))}
              </select>
            </div>

            {/* Trainer in Charge */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Trainer in Charge *
              </label>
              <select
                required
                value={formData.in_charge}
                onChange={(e) => setFormData({ ...formData, in_charge: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                {trainers.map(trainer => (
                  <option key={trainer.id} value={trainer.name}>
                    {trainer.rank} {trainer.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Participating Trainers - ENHANCED */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-semibold text-gray-700">
                  Participating Trainers *
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllFiltered}
                    className="text-sm text-orange-600 hover:text-orange-800 font-medium"
                  >
                    Select All Filtered
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-sm text-orange-600 hover:text-orange-800 font-medium"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Search and Filters - NEW */}
              <div className="bg-gray-50 border rounded-lg p-4 mb-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700">Search & Filter Trainers</h4>
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                  >
                    Clear Filters
                  </button>
                </div>

                {/* Search Bar */}
                <div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name or IC number..."
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>

                {/* Filter Dropdowns */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Rank Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Rank</label>
                    <select
                      value={selectedRank}
                      onChange={(e) => setSelectedRank(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="all">All Ranks</option>
                      {ranks.map(rank => (
                        <option key={rank} value={rank}>{rank}</option>
                      ))}
                    </select>
                  </div>

                  {/* Department Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                    <select
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  {/* Specialization Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Specialization</label>
                    <select
                      value={selectedSpecialization}
                      onChange={(e) => setSelectedSpecialization(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="all">All Specializations</option>
                      {specializations.map(spec => (
                        <option key={spec} value={spec}>{spec}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Filter Summary */}
                <div className="flex items-center justify-between text-xs text-gray-600 pt-2 border-t">
                  <span>
                    Showing {filteredTrainers.length} of {trainers.length} trainers
                  </span>
                  {(searchTerm || selectedRank !== 'all' || selectedDepartment !== 'all' || selectedSpecialization !== 'all') && (
                    <span className="text-orange-600 font-medium">
                      {filteredTrainers.length === 0 ? 'No matches found' : 'Filters active'}
                    </span>
                  )}
                </div>
              </div>

              {/* Selected Trainers Summary */}
              {selectedTrainers.length > 0 && (
                <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      <h3 className="font-semibold text-orange-900">
                        Selected Trainers ({selectedTrainers.length})
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {selectedTrainers.map((trainer: any) => (
                      <div
                        key={trainer.id}
                        className="flex items-center justify-between bg-white px-3 py-2 rounded border border-orange-200"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-sm font-semibold text-orange-700">
                              {trainer.name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-900">
                              {trainer.name}
                            </p>
                            <p className="text-xs text-gray-600">
                              {trainer.rank} • {trainer.department || 'No department'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleParticipant(trainer.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trainer Selection Grid */}
              <div className="border rounded-lg p-4 bg-gray-50">
                <p className="text-sm text-gray-600 mb-3">
                  Select trainers who will participate in this training
                  {formData.participants.length === 0 && ' (none selected)'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {filteredTrainers.map((trainer: any) => (
                    <label
                      key={trainer.id}
                      className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition ${formData.participants.includes(trainer.id)
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.participants.includes(trainer.id)}
                        onChange={() => toggleParticipant(trainer.id)}
                        className="w-5 h-5 text-orange-600 rounded focus:ring-orange-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate">
                          {trainer.name}
                        </p>
                        <p className="text-xs text-gray-600 truncate">
                          {trainer.rank}
                          {trainer.department && ` • ${trainer.department}`}
                        </p>
                        {trainer.specialization && (
                          <p className="text-xs text-orange-600 truncate mt-1">
                            {trainer.specialization}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                {filteredTrainers.length === 0 && (
                  <div className="text-center py-8">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-sm text-gray-500 font-medium">No trainers found</p>
                    <p className="text-xs text-gray-400 mt-1">Try adjusting your search or filters</p>
                  </div>
                )}

                {trainers.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No active trainers available
                  </p>
                )}
              </div>

              {/* Selection Validation Message */}
              {formData.participants.length === 0 && (
                <p className="text-xs text-red-600 mt-2">
                  * At least one participating trainer is required
                </p>
              )}
            </div>

            {/* Form Actions */}
            <div className="bg-gray-50 px-6 py-4 -mx-6 -mb-6 flex justify-end space-x-3 rounded-b-lg sticky bottom-0">
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
                className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Assigning...</span>
                  </>
                ) : (
                  <span>Assign Training</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}