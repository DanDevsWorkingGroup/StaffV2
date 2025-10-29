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

  return {
    trainers: trainers || [],
    trainingSessions: trainingSessions || []
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
  const { trainers, trainingSessions } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showModal, setShowModal] = useState(false)

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

  // Get trainings for a specific date
  const getTrainingsForDate = (day: number) => {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return trainingSessions.filter((t: any) => t.date === dateStr)
  }

  const handleDateClick = (day: number) => {
    const selected = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    setSelectedDate(selected)
    setShowModal(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Physical Training Schedule</h1>
        <p className="text-gray-600">Schedule after-hours physical activities (5:00 PM - 7:00 PM)</p>
      </div>

      {/* Month Navigation */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              const newDate = new Date(currentDate)
              newDate.setMonth(currentDate.getMonth() - 1)
              setCurrentDate(newDate)
            }}
            className="p-2 hover:bg-gray-100 rounded-lg"
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
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            Next ▶
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
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
                  aspect-square border-2 rounded-lg p-2 cursor-pointer transition
                  hover:shadow-lg hover:border-blue-500
                  ${isToday ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}
                `}
              >
                <div className={`font-semibold mb-1 ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
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
                    <div className="text-xs text-gray-600">
                      +{trainings.length - 2} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Training Events List */}
      {selectedDate && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold mb-4">
            Training Events for {selectedDate.toLocaleDateString('en-US', { 
              month: 'long', 
              day: 'numeric',
              year: 'numeric'
            })}
          </h3>
          
          {getTrainingsForDate(selectedDate.getDate()).length === 0 ? (
            <p className="text-gray-600">No training scheduled for this date</p>
          ) : (
            <div className="space-y-3">
              {getTrainingsForDate(selectedDate.getDate()).map((training: any) => (
                <div key={training.id} className="border-l-4 border-orange-500 bg-orange-50 p-4 rounded">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-gray-900">{training.training_type}</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        <strong>In Charge:</strong> {training.in_charge}
                      </p>
                      <p className="text-sm text-gray-600">
                        <strong>Participants:</strong> {training.participants.length} trainers
                      </p>
                      <p className="text-sm text-gray-600">
                        <strong>Time:</strong> {training.time_slot}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="bg-green-50 border-b px-6 py-4 flex justify-between items-center sticky top-0">
          <h3 className="text-xl font-semibold text-gray-900">
            Assign Physical Training
          </h3>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 text-2xl"
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
  )
}