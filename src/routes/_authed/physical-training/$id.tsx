import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'

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

interface SessionDetailData {
    session: PhysicalTrainingSession
    assignedTrainers: Trainer[]
}

// ===== SERVER FUNCTIONS =====

/**
 * Fetch PT session details with assigned trainers
 */
const getSessionDetail = createServerFn({ method: 'GET' })
    .inputValidator((id: string) => id)
    .handler(async ({ data: id }) => {
        const supabase = getSupabaseServerClient()

        // Fetch session details
        const { data: session, error: sessionError } = await supabase
            .from('physical_training')
            .select('*')
            .eq('id', id)
            .single()

        if (sessionError || !session) {
            throw new Error('Physical training session not found')
        }

        // Fetch assigned trainers
        let assignedTrainers: Trainer[] = []

        if (session.participants && session.participants.length > 0) {
            const { data: trainers, error: trainersError } = await supabase
                .from('trainers')
                .select('id, name, rank, specialization, status')
                .in('id', session.participants)
                .eq('status', 'active')
                .order('name', { ascending: true })

            if (!trainersError && trainers) {
                assignedTrainers = trainers
            }
        }

        return {
            session,
            assignedTrainers,
        } as SessionDetailData
    })

/**
 * Delete PT session — ADMIN / COORDINATOR / PT COORDINATOR only (FSD §5.1)
 */
const deleteSession = createServerFn({ method: 'POST' })
    .inputValidator((id: number) => id)
    .handler(async ({ data: id }) => {
      checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'PT COORDINATOR'])

        const supabase = getSupabaseServerClient()

        const { error } = await supabase
            .from('physical_training')
            .delete()
            .eq('id', id)

        if (error) {
            throw new Error(`Failed to delete session: ${error.message}`)
        }

        return { success: true }
    })

// ===== ROUTE CONFIGURATION =====

export const Route = createFileRoute('/_authed/physical-training/$id')({
    loader: async ({ params }) => await getSessionDetail({ data: params.id }),
    component: PhysicalTrainingDetailPage,
})

// ===== HELPER FUNCTIONS =====

/**
 * Who may edit / delete PT sessions (FSD §5.1)
 */
function canManageSessions(role?: string): boolean {
    return role === 'ADMIN' || role === 'COORDINATOR' || role === 'PT COORDINATOR'
}

/**
 * Format date to readable string
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}

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

/**
 * Get day of week from date
 */
function getDayOfWeek(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// ===== MAIN COMPONENT =====

function PhysicalTrainingDetailPage() {
    const { session, assignedTrainers } = Route.useLoaderData()
    const { user } = Route.useRouteContext()
    const navigate = useNavigate()
    const [isDeleting, setIsDeleting] = useState(false)

    const canManage = canManageSessions(user?.role)

    // Handle delete action
    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this training session? This action cannot be undone.')) {
            return
        }

        try {
            setIsDeleting(true)
            await deleteSession({ data: session.id })
            alert('Training session deleted successfully')
            navigate({ to: '/physical-training' })
        } catch (error) {
            console.error('Delete error:', error)
            alert('Failed to delete session. Please try again.')
            setIsDeleting(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link
                        to="/physical-training"
                        className="p-2 hover:bg-gray-100 rounded-lg transition flex items-center justify-center"
                    >
                        <span className="text-xl">←</span>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            Physical Training Session Details
                        </h1>
                        <p className="text-gray-600 mt-1">
                            View session information and assigned participants
                        </p>
                    </div>
                </div>

                {/* Action Buttons - Only for ADMIN/COORDINATOR */}
                {canManage && (
                    <div className="flex space-x-3">
                        <Link
                            to="/physical-training/edit/$id"
                            params={{ id: session.id.toString() }}
                            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                            <span className="text-lg">✏️</span>
                            <span>Edit</span>
                        </Link>
                        <button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span className="text-lg">🗑️</span>
                            <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Session Details Card */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                {/* Session Header */}
                <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8 text-white">
                    <div className="flex items-start space-x-4">
                        <div className="text-6xl">{getTrainingIcon(session.training_type)}</div>
                        <div className="flex-1">
                            <h2 className="text-3xl font-bold mb-2">{session.training_type}</h2>
                            <div className="flex flex-wrap gap-4 text-orange-100">
                                <div className="flex items-center space-x-2">
                                    <span className="text-xl">📅</span>
                                    <span className="font-medium">{formatDate(session.date)}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <span className="text-xl">⏰</span>
                                    <span className="font-medium">{session.time_slot}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <span className="text-xl">📍</span>
                                    <span className="font-medium">{getDayOfWeek(session.date)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Session Information */}
                <div className="p-6 border-b">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                        <span className="text-xl text-orange-600">📋</span>
                        <span>Session Information</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <p className="text-sm text-gray-600 mb-1">Training Type</p>
                            <p className="text-lg font-semibold text-gray-900">{session.training_type}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 mb-1">Date</p>
                            <p className="text-lg font-semibold text-gray-900">
                                {new Date(session.date).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                })}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 mb-1">Time Slot</p>
                            <p className="text-lg font-semibold text-gray-900">{session.time_slot}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 mb-1">In Charge</p>
                            <p className="text-lg font-semibold text-gray-900">{session.in_charge}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 mb-1">Total Participants</p>
                            <p className="text-lg font-semibold text-gray-900">
                                {assignedTrainers.length} participant{assignedTrainers.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Assigned Participants Section */}
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                        <span className="text-xl text-orange-600">👥</span>
                        <span>
                            Assigned Participants ({assignedTrainers.length})
                        </span>
                    </h3>

                    {assignedTrainers.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-8 text-center">
                            <span className="text-5xl block mb-3">👥</span>
                            <p className="text-gray-600 font-medium">No participants assigned</p>
                            <p className="text-sm text-gray-500 mt-1">
                                Participants will appear here once assigned
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {assignedTrainers.map((trainer) => (
                                <div
                                    key={trainer.id}
                                    className="bg-orange-50 border border-orange-200 rounded-lg p-4 hover:shadow-md transition"
                                >
                                    {/* Trainer Avatar */}
                                    <div className="flex items-start space-x-3">
                                        <div className="w-12 h-12 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                                            {trainer.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-gray-900 truncate">
                                                {trainer.name}
                                            </h4>
                                            <p className="text-sm text-orange-700 font-medium mt-1">
                                                {trainer.rank}
                                            </p>
                                            {trainer.specialization && (
                                                <p className="text-xs text-gray-600 mt-1 truncate">
                                                    {trainer.specialization}
                                                </p>
                                            )}
                                            <div className="mt-2">
                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                    ✓ Active
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Additional Information */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                    <div className="text-blue-600 text-2xl flex-shrink-0">ℹ️</div>
                    <div>
                        <h4 className="font-semibold text-blue-900 mb-1">About Physical Training Sessions</h4>
                        <p className="text-sm text-blue-800">
                            Physical training sessions are scheduled to maintain fitness standards and operational
                            readiness for trainers at ABPM. All assigned participants are expected to attend
                            unless excused due to injury or official duties.
                        </p>
                    </div>
                </div>
            </div>

            {/* Debug Info (Development Only) */}
            {/*{process.env.NODE_ENV === 'development' && (
                <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-xs">
                    <p className="font-semibold text-gray-700 mb-2">Debug Information:</p>
                    <pre className="text-gray-600 overflow-x-auto">
                        {JSON.stringify({
                            sessionId: session.id,
                            participants: session.participants,
                            assignedCount: assignedTrainers.length,
                            canManage,
                            userRole: user?.role
                        }, null, 2)}
                    </pre>
                </div>
            )}*/}
        </div>
    )
}