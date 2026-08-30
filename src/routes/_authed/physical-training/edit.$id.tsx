import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'

const PT_MANAGER_ROLES = ['ADMIN', 'COORDINATOR', 'PT COORDINATOR']

// ===== TYPE DEFINITIONS =====

interface PhysicalTrainingSession {
  id: number
  date: string
  training_type: string
  in_charge: string
  participants: number[]
  time_slot: string
  created_at: string
}

interface Trainer {
  id: number
  name: string
  rank: string
  specialization: string | null
  status: string
}

interface EditSessionData {
  session: PhysicalTrainingSession
  trainers: Trainer[]
}

// ===== SERVER FUNCTIONS =====

/**
 * Fetch session for editing
 */
const getSessionForEdit = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const supabase = getSupabaseServerClient()

    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from('physical_training')
      .select('*')
      .eq('id', id)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    // Fetch trainers for participant selection
    const { data: trainers, error: trainersError } = await supabase
      .from('trainers')
      .select('id, name, rank, specialization, status')
      .eq('status', 'active')
      .order('name', { ascending: true })

    if (trainersError) {
      console.error('Error fetching trainers:', trainersError)
    }

    return {
      session,
      trainers: trainers || []
    } as EditSessionData
  })

/**
 * Update session
 */
const updateSession = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    id: number
    date: string
    training_type: string
    in_charge: string
    participants: number[]
    time_slot: string
  }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'])

    const supabase = getSupabaseServerClient()

    const { id, ...updateData } = data

    const { error } = await supabase
      .from('physical_training')
      .update(updateData)
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update: ${error.message}`)
    }

    return { success: true }
  })

// ===== ROUTE CONFIGURATION =====

export const Route = createFileRoute('/_authed/physical-training/edit/$id')({
  beforeLoad: ({ context }) => {
    if (!context.user?.role || !PT_MANAGER_ROLES.includes(context.user.role)) {
      throw new Error('Unauthorized Access: Only Admins, Coordinators and PT Coordinators can edit physical-training sessions')
    }
  },
  loader: async ({ params }) => {
    try {
      return await getSessionForEdit({ data: params.id })
    } catch (error) {
      console.error('Loader error:', error)
      throw error
    }
  },
  component: EditSessionPage,
})

// ===== HELPER FUNCTIONS =====

/**
 * Get training type icon
 */
function getTrainingIcon(trainingType: string): string {
  const type = trainingType.toLowerCase()
  if (type.includes('fitness') || type.includes('physical')) return '💪'
  if (type.includes('cardio')) return '🏃'
  if (type.includes('strength')) return '🏋️'
  if (type.includes('endurance')) return '⚡'
  if (type.includes('combat')) return '🥊'
  if (type.includes('swimming')) return '🏊'
  if (type.includes('running')) return '🏃'
  return '🎯'
}

// ===== MAIN COMPONENT =====

function EditSessionPage() {
  const loaderData = Route.useLoaderData()
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)

  // Defensive check for undefined data
  if (!loaderData || !loaderData.session) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-900 mb-2">Error Loading Session</h2>
          <p className="text-red-700 mb-4">Unable to load training session data. The session may not exist or you may not have permission to edit it.</p>
          <Link
            to="/physical-training"
            className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            ← Back to Physical Training
          </Link>
        </div>
      </div>
    )
  }

  const { session, trainers } = loaderData

  const [formData, setFormData] = useState({
    date: session.date,
    training_type: session.training_type,
    in_charge: session.in_charge,
    participants: session.participants || [],
    time_slot: session.time_slot
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setIsSaving(true)
      await updateSession({
        data: {
          id: session.id,
          ...formData
        }
      })

      alert('Training session updated successfully!')
      navigate({
        to: '/physical-training/$id',
        params: { id: session.id.toString() }
      })
    } catch (error) {
      console.error('Update error:', error)
      alert('Failed to update session. Please try again.')
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/physical-training/$id"
            params={{ id: session.id.toString() }}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <span className="text-xl">←</span>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Edit Physical Training Session</h1>
            <p className="text-gray-600 mt-1">Update session information and participants</p>
          </div>
        </div>
      </div>

      {/* Session Info Banner */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg p-6 text-white">
        <div className="flex items-center space-x-4">
          <div className="text-5xl">{getTrainingIcon(session.training_type)}</div>
          <div>
            <h2 className="text-2xl font-bold">Editing: {session.training_type}</h2>
            <p className="text-orange-100">
              Original: {new Date(session.date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })} | {session.time_slot}
            </p>
          </div>
        </div>
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6 space-y-6">
        {/* Date Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            required
          />
        </div>

        {/* Training Type Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Training Type <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.training_type}
            onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            required
          >
            <option value="">Select training type</option>
            <option value="Physical Fitness Training">💪 Physical Fitness Training</option>
            <option value="Cardio Training">🏃 Cardio Training</option>
            <option value="Strength Training">🏋️ Strength Training</option>
            <option value="Endurance Training">⚡ Endurance Training</option>
            <option value="Combat Training">🥊 Combat Training</option>
            <option value="Swimming">🏊 Swimming</option>
            <option value="Running">🏃 Running</option>
            <option value="Agility Training">🤸 Agility Training</option>
            <option value="Team Building">🤝 Team Building</option>
          </select>
        </div>

        {/* Time Slot Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Time Slot <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.time_slot}
            onChange={(e) => setFormData({ ...formData, time_slot: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="e.g., 6:00 PM - 7:00 PM"
            required
          />
          <p className="text-sm text-gray-500 mt-1">
            Format: 6:00 PM - 7:00 PM (or 18:00 - 19:00)
          </p>
        </div>

        {/* In Charge Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            In Charge <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.in_charge}
            onChange={(e) => setFormData({ ...formData, in_charge: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="Enter trainer name in charge"
            required
          />
          <p className="text-sm text-gray-500 mt-1">
            Full name of the trainer leading this session
          </p>
        </div>

        {/* Participants Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Participants ({formData.participants.length} selected)
          </label>
          <div className="border border-gray-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-gray-50">
            {trainers.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No active trainers available</p>
            ) : (
              <div className="space-y-2">
                {trainers.map((trainer) => (
                  <label
                    key={trainer.id}
                    className="flex items-center space-x-3 p-3 hover:bg-orange-50 rounded cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={formData.participants.includes(trainer.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            participants: [...formData.participants, trainer.id]
                          })
                        } else {
                          setFormData({
                            ...formData,
                            participants: formData.participants.filter((id: number) => id !== trainer.id)
                          })
                        }
                      }}
                      className="w-5 h-5 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold">
                          {trainer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{trainer.name}</p>
                          <p className="text-sm text-orange-700">{trainer.rank}</p>
                          {trainer.specialization && (
                            <p className="text-xs text-gray-600">{trainer.specialization}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Select trainers who will participate in this training session
          </p>
        </div>

        {/* Submit Buttons */}
        <div className="flex justify-end space-x-3 pt-6 border-t">
          <Link
            to="/physical-training/$id"
            params={{ id: session.id.toString() }}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSaving ? (
              <>
                <span className="animate-spin">⏳</span>
                <span>Saving...</span>
              </>
            ) : (
              <>
                <span>💾</span>
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Debug Info (Development Only) */}
      {/*{process.env.NODE_ENV === 'development' && (
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-xs">
          <p className="font-semibold text-gray-700 mb-2">Debug Information:</p>
          <pre className="text-gray-600 overflow-x-auto">
            {JSON.stringify({
              sessionId: session.id,
              currentParticipants: formData.participants,
              availableTrainers: trainers.length
            }, null, 2)}
          </pre>
        </div>
      )}*/}
    </div>
  )
}