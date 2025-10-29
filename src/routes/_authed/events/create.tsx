import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to fetch trainers
const getTrainers = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true })

  return { trainers: trainers || [] }
})

// Server function to create event with trainer assignments
const createEventWithTrainers = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    name: string
    category: string
    start_date: string
    end_date: string
    description?: string
    color: string
    trainer_ids: number[]
  }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    
    // Create the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert([{
        name: data.name,
        category: data.category,
        start_date: data.start_date,
        end_date: data.end_date,
        description: data.description,
        color: data.color
      }])
      .select()
      .single()

    if (eventError) {
      return { error: eventError.message }
    }

    // Create schedule entries for each selected trainer for each day of the event
    if (data.trainer_ids.length > 0) {
      const scheduleEntries = []
      const startDate = new Date(data.start_date)
      const endDate = new Date(data.end_date)
      
      // Loop through each date in the event range
      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dateStr = date.toISOString().split('T')[0]
        
        // Create schedule entry for each trainer
        for (const trainerId of data.trainer_ids) {
          scheduleEntries.push({
            trainer_id: trainerId,
            date: dateStr,
            status: 'scheduled',
            availability: [], // Can be updated later
            notes: `Assigned to: ${data.name}`
          })
        }
      }

      // Insert all schedule entries
      const { error: scheduleError } = await supabase
        .from('schedules')
        .insert(scheduleEntries)

      if (scheduleError) {
        console.error('Error creating schedules:', scheduleError)
        // Don't fail the entire operation if schedule creation fails
      }
    }

    return { success: true, event }
  })

const EVENT_CATEGORIES = [
  { name: 'Physical Training', color: '#3b82f6' },
  { name: 'Safety Training', color: '#8b5cf6' },
  { name: 'Emergency Response', color: '#ef4444' },
  { name: 'Equipment Inspection', color: '#f59e0b' },
  { name: 'Leadership Training', color: '#eab308' },
  { name: 'Team Building', color: '#10b981' },
  { name: 'Religious Activity', color: '#14b8a6' },
  { name: 'Community Service', color: '#06b6d4' },
  { name: 'Routine Maintenance', color: '#92400e' },
  { name: 'Special Event', color: '#ec4899' },
  { name: 'Development Program', color: '#6366f1' },
  { name: 'Collaboration Activity', color: '#a855f7' },
]

export const Route = createFileRoute('/_authed/events/create')({
  loader: async () => await getTrainers(),
  component: CreateEventPage,
})

function CreateEventPage() {
  const navigate = useNavigate()
  const { trainers } = Route.useLoaderData()
  
  const [formData, setFormData] = useState({
    name: '',
    category: EVENT_CATEGORIES[0].name,
    start_date: '',
    end_date: '',
    description: '',
    color: EVENT_CATEGORIES[0].color,
    trainer_ids: [] as number[],
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Handle category change and update color
  const handleCategoryChange = (category: string) => {
    const selectedCategory = EVENT_CATEGORIES.find(c => c.name === category)
    setFormData({
      ...formData,
      category,
      color: selectedCategory?.color || EVENT_CATEGORIES[0].color
    })
  }

  // Handle trainer selection
  const handleTrainerToggle = (trainerId: number) => {
    setFormData(prev => ({
      ...prev,
      trainer_ids: prev.trainer_ids.includes(trainerId)
        ? prev.trainer_ids.filter(id => id !== trainerId)
        : [...prev.trainer_ids, trainerId]
    }))
  }

  // Select all trainers
  const handleSelectAll = () => {
    setFormData(prev => ({
      ...prev,
      trainer_ids: trainers.map((t: any) => t.id)
    }))
  }

  // Deselect all trainers
  const handleDeselectAll = () => {
    setFormData(prev => ({
      ...prev,
      trainer_ids: []
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      // Validate dates
      if (new Date(formData.end_date) < new Date(formData.start_date)) {
        setError('End date must be after start date')
        setIsSubmitting(false)
        return
      }

      const result = await createEventWithTrainers({ data: formData })
      
      if (result.error) {
        setError(result.error)
        setIsSubmitting(false)
        return
      }

      // Success - navigate back to events list
      navigate({ to: '/events' })
    } catch (err: any) {
      setError(err.message || 'Failed to create event')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Create New Event</h1>
        <p className="text-gray-600">Fill in the details to create a training event and assign trainers</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow">
        <div className="p-6 space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Event Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Event Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter event name"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Category *
            </label>
            <select
              required
              value={formData.category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {EVENT_CATEGORIES.map(cat => (
                <option key={cat.name} value={cat.name}>{cat.name}</option>
              ))}
            </select>
            
            {/* Color Preview */}
            <div className="mt-2 flex items-center space-x-2">
              <span className="text-sm text-gray-600">Color:</span>
              <div 
                className="w-8 h-8 rounded-full border-2 border-gray-300"
                style={{ backgroundColor: formData.color }}
              />
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Start Date *
              </label>
              <input
                type="date"
                required
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                End Date *
              </label>
              <input
                type="date"
                required
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter event description (optional)"
            />
          </div>

          {/* Trainer Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-semibold text-gray-700">
                Assign Trainers
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Deselect All
                </button>
              </div>
            </div>
            
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-600 mb-3">
                Select trainers who will be assigned to this event 
                ({formData.trainer_ids.length} selected)
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto">
                {trainers.map((trainer: any) => (
                  <label
                    key={trainer.id}
                    className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                      formData.trainer_ids.includes(trainer.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.trainer_ids.includes(trainer.id)}
                      onChange={() => handleTrainerToggle(trainer.id)}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">
                        {trainer.name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {trainer.specialization || trainer.rank}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              
              {trainers.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No active trainers available
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3 rounded-b-lg">
          <button
            type="button"
            onClick={() => navigate({ to: '/events' })}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  )
}