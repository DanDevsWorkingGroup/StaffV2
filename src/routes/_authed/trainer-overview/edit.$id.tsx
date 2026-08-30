import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'

// Server function to get trainer data
const getTrainerData = createServerFn({ method: 'GET' })
  .inputValidator((data: { trainerId: string }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    
    const trainerId = parseInt(data.trainerId)
    
    const { data: trainer, error } = await supabase
      .from('trainers')
      .select('*')
      .eq('id', trainerId)
      .single()

    if (error || !trainer) {
      throw new Error('Trainer not found')
    }

    return trainer
  })

// Server function to update trainer
const updateTrainer = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    trainerId: number
    name: string
    rank: string
    specialization: string
    department: string
    region: string
    status: string
  }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN'])

    const supabase = getSupabaseServerClient()

    // Update trainer data (NO EMAIL - it's in auth.users)
    const { error } = await supabase
      .from('trainers')
      .update({
        name: data.name,
        rank: data.rank,
        specialization: data.specialization,
        department: data.department,
        region: data.region,
        status: data.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', data.trainerId)

    if (error) {
      console.error('Error updating trainer:', error)
      throw new Error('Failed to update trainer')
    }

    return { success: true }
  })

export const Route = createFileRoute('/_authed/trainer-overview/edit/$id')({
  beforeLoad: ({ context }) => {
    if (context.user?.role !== 'ADMIN') {
      throw new Error('Unauthorized Access: Only Admins can edit trainer records')
    }
  },
  loader: async ({ params }) => await getTrainerData({ data: { trainerId: params.id } }),
  component: EditTrainerPage,
})

function EditTrainerPage() {
  const trainer = Route.useLoaderData()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    name: trainer.name || '',
    rank: trainer.rank || '',
    specialization: trainer.specialization || '',
    department: trainer.department || '',
    region: trainer.region || '',
    status: trainer.status || 'active'
  })

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSaving(true)

    try {
      await updateTrainer({
        data: {
          trainerId: trainer.id,
          ...formData
        }
      })
      
      // Navigate back to profile page
      navigate({ 
        to: '/trainer-overview/$id', 
        params: { id: trainer.id.toString() } 
      })
    } catch (err: any) {
      setError(err.message || 'Failed to update trainer')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-6 mb-6 text-white">
        <h1 className="text-3xl font-bold mb-2">Edit Trainer Profile</h1>
        <p className="text-orange-100">Update trainer information</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border-2 border-red-200 rounded-lg">
            <p className="text-red-800 font-semibold">❌ {error}</p>
          </div>
        )}

        {/* Email Note */}
        <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
          <p className="text-sm text-blue-900">
            <strong>ℹ️ Note:</strong> Email addresses are managed through the authentication system and cannot be changed here. To update a trainer's email, contact the system administrator.
          </p>
        </div>

        {/* Personal Information Section */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
            <span className="text-2xl mr-2">👤</span>
            Personal Information
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              label="Full Name"
              value={formData.name}
              onChange={(value) => handleChange('name', value)}
              required
            />
            <FormField
              label="Rank"
              value={formData.rank}
              onChange={(value) => handleChange('rank', value)}
              placeholder="e.g., KB32, KB19, KB6"
              required
            />
            <FormField
              label="Region"
              value={formData.region}
              onChange={(value) => handleChange('region', value)}
              placeholder="e.g., Terengganu"
              required
            />
            <FormField
              label="Specialization"
              value={formData.specialization}
              onChange={(value) => handleChange('specialization', value)}
              placeholder="e.g., PKPgB, PgKB I"
              required
            />
            <div className="md:col-span-2">
              <FormField
                label="Department"
                value={formData.department}
                onChange={(value) => handleChange('department', value)}
                placeholder="e.g., PENGAJIAN PENYELAMATAN, CAWANGAN PRAKTIKAL"
                required
              />
            </div>
            <FormSelect
              label="Status"
              value={formData.status}
              onChange={(value) => handleChange('status', value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'lead', label: 'Lead' }
              ]}
              required
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-6 border-t">
          <button
            type="button"
            onClick={() => navigate({ 
              to: '/trainer-overview/$id', 
              params: { id: trainer.id.toString() } 
            })}
            className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition"
            disabled={isSaving}
          >
            Cancel
          </button>
          
          <button
            type="submit"
            disabled={isSaving}
            className={`px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition ${
              isSaving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isSaving ? '💾 Saving...' : '💾 Save Changes'}
          </button>
        </div>
      </form>

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          <strong>ℹ️ Note:</strong> Changes will be reflected immediately across all modules where this trainer is assigned.
        </p>
      </div>
    </div>
  )
}

// Helper Components
function FormField({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  placeholder = ''
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
      />
    </div>
  )
}

function FormSelect({
  label,
  value,
  onChange,
  options,
  required = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}