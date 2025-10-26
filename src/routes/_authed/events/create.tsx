import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to create event
const createEvent = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    name: string
    category: string
    start_date: string
    end_date: string
    description?: string
  }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    
    const { data: event, error } = await supabase
      .from('events')
      .insert([data])
      .select()
      .single()

    if (error) {
      return { error: error.message }
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
  component: CreateEventPage,
})

function CreateEventPage() {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({
    name: '',
    category: EVENT_CATEGORIES[0].name,
    start_date: '',
    end_date: '',
    description: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

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

      const result = await createEvent({ data: formData })
      
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
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Create New Event</h1>
        <p className="text-gray-600">Fill in the details to create a training event</p>
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
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
                style={{ 
                  backgroundColor: EVENT_CATEGORIES.find(c => c.name === formData.category)?.color 
                }}
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