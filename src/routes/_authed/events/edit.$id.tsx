import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState } from 'react'

const EVENT_MANAGER_ROLES = ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR']

// Get event
const getEvent = createServerFn({ method: 'GET' })
    .inputValidator((id: string) => id)
    .handler(async ({ data: id }) => {
        const supabase = getSupabaseServerClient()

        const { data: event, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', id)
            .single()

        if (error) throw error
        return { event }
    })

// Get all trainers
const getAllTrainers = createServerFn({ method: 'GET' }).handler(async () => {
    const supabase = getSupabaseServerClient()

    const { data: trainers } = await supabase
        .from('trainers')
        .select('id, name, rank')
        .eq('status', 'active')
        .order('rank', { ascending: true })

    return { trainers: trainers || [] }
})

// Update event
const updateEvent = createServerFn({ method: 'POST' })
    .inputValidator((data: any) => data)
    .handler(async ({ data }) => {
        checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'])

        const supabase = getSupabaseServerClient()

        const { error } = await supabase
            .from('events')
            .update({
                name: data.name,
                category: data.category,
                start_date: data.start_date,
                end_date: data.end_date,
                description: data.description,
                color: data.color,
            })
            .eq('id', data.id)

        if (error) throw error

        // Update trainer assignments if provided
        if (data.trainer_ids) {
            // Delete existing assignments
            await supabase
                .from('event_trainer_schedule')
                .delete()
                .eq('event_id', data.id)

            // Insert new assignments
            if (data.trainer_ids.length > 0) {
                const assignments = data.trainer_ids.map((trainer_id: number) => ({
                    event_id: parseInt(data.id),
                    trainer_id,
                }))

                await supabase
                    .from('event_trainer_schedule')
                    .insert(assignments)
            }
        }

        return { success: true }
    })

export const Route = createFileRoute('/_authed/events/edit/$id')({
    beforeLoad: ({ context }) => {
        if (!context.user?.role || !EVENT_MANAGER_ROLES.includes(context.user.role)) {
            throw new Error('Unauthorized Access: Only Admins, Coordinators and Event Coordinators can edit events')
        }
    },
    loader: async ({ params }) => {
        const [eventData, trainersData] = await Promise.all([
            getEvent({ data: params.id }),
            getAllTrainers()
        ])
        return { ...eventData, ...trainersData }
    },
    component: EditEventPage,
})

const EVENT_COLORS = [
    { name: 'Physical Training', color: '#3b82f6', bg: 'bg-blue-500' },
    { name: 'Safety Training', color: '#8b5cf6', bg: 'bg-purple-500' },
    { name: 'Emergency Response', color: '#ef4444', bg: 'bg-red-500' },
    { name: 'Equipment Inspection', color: '#f59e0b', bg: 'bg-orange-500' },
    { name: 'Leadership Training', color: '#eab308', bg: 'bg-yellow-500' },
    { name: 'Team Building', color: '#10b981', bg: 'bg-green-500' },
    { name: 'Religious Activity', color: '#14b8a6', bg: 'bg-teal-500' },
    { name: 'Community Service', color: '#06b6d4', bg: 'bg-cyan-500' },
    { name: 'Routine Maintenance', color: '#92400e', bg: 'bg-amber-800' },
    { name: 'Special Event', color: '#ec4899', bg: 'bg-pink-500' },
    { name: 'Development Program', color: '#6366f1', bg: 'bg-indigo-500' },
    { name: 'Collaboration Activity', color: '#a855f7', bg: 'bg-violet-500' },
]

function EditEventPage() {
    const { event, trainers } = Route.useLoaderData()
    const navigate = useNavigate()
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [formData, setFormData] = useState({
        name: event.name,
        category: event.category,
        start_date: event.start_date,
        end_date: event.end_date,
        description: event.description || '',
        color: event.color || '#3b82f6',
    })

    const [selectedTrainers, setSelectedTrainers] = useState<number[]>([])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)

        try {
            await updateEvent({
                data: {
                    id: event.id.toString(),
                    ...formData,
                    trainer_ids: selectedTrainers,
                }
            })

            alert('Event updated successfully!')
            navigate({ to: '/events/$id', params: { id: event.id.toString() } })
        } catch (error) {
            console.error('Update error:', error)
            alert('Failed to update event. Please try again.')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleTrainerToggle = (trainerId: number) => {
        setSelectedTrainers(prev =>
            prev.includes(trainerId)
                ? prev.filter((id: number) => id !== trainerId)
                : [...prev, trainerId]
        )
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Edit Event</h1>
                        <p className="text-blue-100 mt-1">Update event information and trainer assignments</p>
                    </div>
                    <Link
                        to="/events/$id"
                        params={{ id: event.id.toString() }}
                        className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition"
                    >
                        ← Back to Event
                    </Link>
                </div>
            </div>

            {/* Edit Form */}
            <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg p-6 space-y-6">
                {/* Event Name */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Event Name *
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                    />
                </div>

                {/* Category */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Category *
                    </label>
                    <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                    >
                        {EVENT_COLORS.map((cat) => (
                            <option key={cat.name} value={cat.name}>
                                {cat.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Start Date *
                        </label>
                        <input
                            type="date"
                            value={formData.start_date}
                            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            End Date *
                        </label>
                        <input
                            type="date"
                            value={formData.end_date}
                            onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            required
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
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Event description or objectives..."
                    />
                </div>

                {/* Trainer Selection */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                        Assign Trainers ({selectedTrainers.length} selected)
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-4 bg-gray-50 rounded-lg">
                        {trainers.map((trainer: any) => (
                            <label
                                key={trainer.id}
                                className="flex items-center space-x-3 p-3 bg-white rounded-lg border-2 border-gray-200 hover:border-blue-400 cursor-pointer transition"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedTrainers.includes(trainer.id)}
                                    onChange={() => handleTrainerToggle(trainer.id)}
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="font-medium text-gray-900">
                                    {trainer.rank} {trainer.name}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                    <Link
                        to="/events/$id"
                        params={{ id: event.id.toString() }}
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold transition text-center"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    )
}