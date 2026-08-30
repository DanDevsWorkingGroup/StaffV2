import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'

const RA_MANAGER_ROLES = ['ADMIN', 'COORDINATOR', 'RA COORDINATOR']

// ===== TYPE DEFINITIONS =====

interface ReligiousActivity {
    id: number
    date: string
    activity: string
    in_charge: string
    participants: number[]
    created_at: string
}

interface Trainer {
    id: number
    name: string
    rank: string
    specialization: string | null
    status: string
}

interface EditActivityData {
    activity: ReligiousActivity
    trainers: Trainer[]
}

// ===== SERVER FUNCTIONS =====

/**
 * Fetch activity for editing
 */
const getActivityForEdit = createServerFn({ method: 'GET' })
    .inputValidator((id: string) => id)
    .handler(async ({ data: id }) => {
        const supabase = getSupabaseServerClient()

        // Fetch activity
        const { data: activity, error: activityError } = await supabase
            .from('religious_activities')
            .select('*')
            .eq('id', id)
            .single()

        if (activityError || !activity) {
            throw new Error('Activity not found')
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
            activity,
            trainers: trainers || []
        } as EditActivityData
    })

/**
 * Update activity
 */
const updateActivity = createServerFn({ method: 'POST' })
    .inputValidator((data: {
        id: number
        date: string
        activity: string
        in_charge: string
        participants: number[]
    }) => data)
    .handler(async ({ data }) => {
      checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'RA COORDINATOR'])

        const supabase = getSupabaseServerClient()

        const { id, ...updateData } = data

        const { error } = await supabase
            .from('religious_activities')
            .update(updateData)
            .eq('id', id)

        if (error) {
            throw new Error(`Failed to update: ${error.message}`)
        }

        return { success: true }
    })

// ===== ROUTE CONFIGURATION =====

export const Route = createFileRoute('/_authed/religious-activity/edit/$id')({
    beforeLoad: ({ context }) => {
        if (!context.user?.role || !RA_MANAGER_ROLES.includes(context.user.role)) {
            throw new Error('Unauthorized Access: Only Admins, Coordinators and RA Coordinators can edit religious activities')
        }
    },
    loader: async ({ params }) => {
        try {
            return await getActivityForEdit({ data: params.id })
        } catch (error) {
            console.error('Loader error:', error)
            throw error
        }
    },
    component: EditActivityPage,
})

// ===== HELPER FUNCTIONS =====

/**
 * Get activity type icon
 */
function getActivityIcon(activityType: string): string {
    const type = activityType.toLowerCase()
    if (type.includes('fajr')) return '🌅'
    if (type.includes('dhuhr')) return '☀️'
    if (type.includes('asr')) return '🌤️'
    if (type.includes('maghrib')) return '🌆'
    if (type.includes('isha')) return '🌙'
    if (type.includes('friday') || type.includes('jumaat')) return '🕌'
    if (type.includes('tarawih')) return '🌟'
    return '📖'
}

// ===== MAIN COMPONENT =====

function EditActivityPage() {
    const loaderData = Route.useLoaderData()
    const navigate = useNavigate()
    const [isSaving, setIsSaving] = useState(false)

    // Defensive check for undefined data
    if (!loaderData || !loaderData.activity) {
        return (
            <div className="max-w-4xl mx-auto space-y-6 p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <div className="text-6xl mb-4">⚠️</div>
                    <h2 className="text-2xl font-bold text-red-900 mb-2">Error Loading Activity</h2>
                    <p className="text-red-700 mb-4">Unable to load activity data. The activity may not exist or you may not have permission to edit it.</p>
                    <Link
                        to="/religious-activity"
                        className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                    >
                        ← Back to Religious Activities
                    </Link>
                </div>
            </div>
        )
    }

    const { activity, trainers } = loaderData

    const [formData, setFormData] = useState({
        date: activity.date,
        activity: activity.activity,
        in_charge: activity.in_charge,
        participants: activity.participants || []
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        try {
            setIsSaving(true)
            await updateActivity({
                data: {
                    id: activity.id,
                    ...formData
                }
            })

            alert('Activity updated successfully!')
            navigate({
                to: '/religious-activity/$id',
                params: { id: activity.id.toString() }
            })
        } catch (error) {
            console.error('Update error:', error)
            alert('Failed to update activity. Please try again.')
            setIsSaving(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link
                        to="/religious-activity/$id"
                        params={{ id: activity.id.toString() }}
                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                    >
                        <span className="text-xl">←</span>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Edit Religious Activity</h1>
                        <p className="text-gray-600 mt-1">Update activity information and participants</p>
                    </div>
                </div>
            </div>

            {/* Activity Info Banner */}
            <div className="bg-gradient-to-r from-teal-500 to-teal-600 rounded-lg p-6 text-white">
                <div className="flex items-center space-x-4">
                    <div className="text-5xl">{getActivityIcon(activity.activity)}</div>
                    <div>
                        <h2 className="text-2xl font-bold">Editing: {activity.activity}</h2>
                        <p className="text-teal-100">Original Date: {new Date(activity.date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}</p>
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
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        required
                    />
                </div>

                {/* Activity Type Field */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Activity Type <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.activity}
                        onChange={(e) => setFormData({ ...formData, activity: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        required
                    >
                        <option value="">Select activity type</option>
                        <option value="Fajr Prayer">🌅 Fajr Prayer</option>
                        <option value="Dhuhr Prayer">☀️ Dhuhr Prayer</option>
                        <option value="Asr Prayer">🌤️ Asr Prayer</option>
                        <option value="Maghrib Prayer">🌆 Maghrib Prayer</option>
                        <option value="Isha Prayer">🌙 Isha Prayer</option>
                        <option value="Friday Prayer">🕌 Friday Prayer</option>
                        <option value="Tarawih Prayer">🌟 Tarawih Prayer</option>
                        <option value="Quran Reading">📖 Quran Reading</option>
                        <option value="Religious Talk">💬 Religious Talk</option>
                        <option value="Islamic Studies">📚 Islamic Studies</option>
                    </select>
                </div>

                {/* Leader/Imam Field */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Leader/Imam <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.in_charge}
                        onChange={(e) => setFormData({ ...formData, in_charge: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        placeholder="Enter leader/imam name"
                        required
                    />
                    <p className="text-sm text-gray-500 mt-1">
                        Full name of the person leading this activity
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
                                        className="flex items-center space-x-3 p-3 hover:bg-teal-50 rounded cursor-pointer transition"
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
                                            className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                                        />
                                        <div className="flex-1">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold">
                                                    {trainer.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-900">{trainer.name}</p>
                                                    <p className="text-sm text-teal-700">{trainer.rank}</p>
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
                        Select trainers who will participate in this activity
                    </p>
                </div>

                {/* Submit Buttons */}
                <div className="flex justify-end space-x-3 pt-6 border-t">
                    <Link
                        to="/religious-activity/$id"
                        params={{ id: activity.id.toString() }}
                        className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
                            activityId: activity.id,
                            currentParticipants: formData.participants,
                            availableTrainers: trainers.length
                        }, null, 2)}
                    </pre>
                </div>
            )}*/}
        </div>
    )
}