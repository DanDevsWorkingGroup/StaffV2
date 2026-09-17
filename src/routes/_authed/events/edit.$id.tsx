import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useState, useMemo } from 'react'

const EVENT_MANAGER_ROLES = ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR']

// Get event, plus the trainers currently assigned to it.
//
// There is no event_id column on `schedules` — the only link between a
// schedule row and the event that created it is the free-text
// `notes = "Assigned to: <event name>"` convention established by
// createEventWithTrainers in create.tsx. We reuse that same convention here
// so the edit form can show (and correctly replace) the current assignment.
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

        const { data: scheduleRows } = await supabase
            .from('schedules')
            .select('trainer_id')
            .eq('notes', `Assigned to: ${event.name}`)

        const assignedTrainerIds = Array.from(
            new Set((scheduleRows || []).map((r: any) => r.trainer_id))
        )

        return { event, assignedTrainerIds }
    })

// Get all trainers (full columns, needed for the search/rank/department/
// specialization filters — mirrors getTrainers in create.tsx).
const getAllTrainers = createServerFn({ method: 'GET' }).handler(async () => {
    const supabase = getSupabaseServerClient()

    const { data: trainers } = await supabase
        .from('trainers')
        .select('*')
        .eq('status', 'active')
        .order('name', { ascending: true })

    return { trainers: trainers || [] }
})

// Update event
const updateEvent = createServerFn({ method: 'POST' })
    .inputValidator((data: any) => data)
    .handler(async ({ data }) => {
        checkRole(await resolveUserRole(), ['ADMIN', 'COORDINATOR', 'EVENT COORDINATOR'])

        const supabase = getSupabaseServerClient()

        // Read the event as it stands BEFORE this update, so we know which
        // notes value ("Assigned to: <old name>") tags its existing schedule
        // rows. Renaming an event and reassigning trainers in the same save
        // must still find and replace the old rows.
        const { data: existingEvent, error: existingError } = await supabase
            .from('events')
            .select('name')
            .eq('id', data.id)
            .single()

        if (existingError) throw existingError

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

        // Reconcile trainer assignments against `schedules` — the table the
        // Schedule Dashboard and Trainer Overview actually read. (The old
        // code wrote to `event_trainer_schedule` instead, a table no screen
        // reads, which is why reassignment silently had no visible effect.)
        if (data.trainer_ids) {
            const { getSupabaseAdminClient } = await import('~/utils/supabase')
            const adminClient = getSupabaseAdminClient()
            const clientToUse = adminClient || supabase

            // Remove every schedule row this event previously created,
            // regardless of which trainers held them, so a shortened date
            // range or a dropped trainer's rows don't linger.
            await clientToUse
                .from('schedules')
                .delete()
                .eq('notes', `Assigned to: ${existingEvent.name}`)

            if (data.trainer_ids.length > 0) {
                const scheduleEntries = []
                const start = new Date(data.start_date)
                const end = new Date(data.end_date)

                const diffTime = Math.abs(end.getTime() - start.getTime())
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

                for (let i = 0; i <= diffDays; i++) {
                    const currentDate = new Date(start)
                    currentDate.setDate(start.getDate() + i)

                    const year = currentDate.getFullYear()
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
                    const day = String(currentDate.getDate()).padStart(2, '0')
                    const dateStr = `${year}-${month}-${day}`

                    if (dateStr > data.end_date) break

                    for (const trainerId of data.trainer_ids) {
                        scheduleEntries.push({
                            trainer_id: trainerId,
                            date: dateStr,
                            status: 'scheduled',
                            availability: [],
                            notes: `Assigned to: ${data.name}`,
                        })
                    }
                }

                const { error: scheduleError } = await clientToUse
                    .from('schedules')
                    .insert(scheduleEntries)

                if (scheduleError) {
                    console.error('Error creating schedules:', scheduleError)
                    if (adminClient) {
                        console.log('Retrying with standard client...')
                        const { error: retryError } = await supabase
                            .from('schedules')
                            .insert(scheduleEntries)
                        if (retryError) console.error('Retry failed:', retryError)
                    }
                }
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
    const { event, trainers, assignedTrainerIds } = Route.useLoaderData()
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

    // Preload the event's current trainer assignment instead of starting empty.
    const [selectedTrainers, setSelectedTrainers] = useState<number[]>(assignedTrainerIds || [])

    // Search and filter state — mirrors create.tsx so editing has the same
    // trainer-finding tools as creating.
    const [searchTerm, setSearchTerm] = useState('')
    const [selectedRank, setSelectedRank] = useState<string>('all')
    const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
    const [selectedSpecialization, setSelectedSpecialization] = useState<string>('all')

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

    const selectedTrainerRecords = useMemo(() => {
        return trainers.filter((t: any) => selectedTrainers.includes(t.id))
    }, [trainers, selectedTrainers])

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

    const handleSelectAll = () => {
        const allFilteredIds = filteredTrainers.map((t: any) => t.id)
        setSelectedTrainers(prev => [...new Set([...prev, ...allFilteredIds])])
    }

    const handleDeselectAll = () => {
        setSelectedTrainers([])
    }

    const handleClearFilters = () => {
        setSearchTerm('')
        setSelectedRank('all')
        setSelectedDepartment('all')
        setSelectedSpecialization('all')
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
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
                    <div className="flex items-center justify-between mb-3">
                        <label className="block text-sm font-semibold text-gray-700">
                            Assign Trainers ({selectedTrainers.length} selected)
                        </label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleSelectAll}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                            >
                                Select All Filtered
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

                    {/* Search and Filters */}
                    <div className="bg-gray-50 border rounded-lg p-4 mb-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-700">Search & Filter Trainers</h3>
                            <button
                                type="button"
                                onClick={handleClearFilters}
                                className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                            >
                                Clear Filters
                            </button>
                        </div>

                        <div>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search by name or IC number..."
                                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Rank</label>
                                <select
                                    value={selectedRank}
                                    onChange={(e) => setSelectedRank(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Ranks</option>
                                    {ranks.map(rank => (
                                        <option key={rank} value={rank}>{rank}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                                <select
                                    value={selectedDepartment}
                                    onChange={(e) => setSelectedDepartment(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Departments</option>
                                    {departments.map(dept => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Specialization</label>
                                <select
                                    value={selectedSpecialization}
                                    onChange={(e) => setSelectedSpecialization(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Specializations</option>
                                    {specializations.map(spec => (
                                        <option key={spec} value={spec}>{spec}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-600 pt-2 border-t">
                            <span>
                                Showing {filteredTrainers.length} of {trainers.length} trainers
                            </span>
                            {(searchTerm || selectedRank !== 'all' || selectedDepartment !== 'all' || selectedSpecialization !== 'all') && (
                                <span className="text-blue-600 font-medium">
                                    {filteredTrainers.length === 0 ? 'No matches found' : 'Filters active'}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Selected Trainers Summary */}
                    {selectedTrainerRecords.length > 0 && (
                        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <h3 className="font-semibold text-blue-900 mb-2">
                                Selected Trainers ({selectedTrainerRecords.length})
                            </h3>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {selectedTrainerRecords.map((trainer: any) => (
                                    <div
                                        key={trainer.id}
                                        className="flex items-center justify-between bg-white px-3 py-2 rounded border border-blue-200"
                                    >
                                        <div>
                                            <p className="font-medium text-sm text-gray-900">
                                                {trainer.rank} {trainer.name}
                                            </p>
                                            <p className="text-xs text-gray-600">
                                                {trainer.department || 'No department'}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleTrainerToggle(trainer.id)}
                                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="border rounded-lg p-4 bg-gray-50">
                        <p className="text-sm text-gray-600 mb-3">
                            Select trainers who will be assigned to this event
                            {selectedTrainers.length === 0 && ' (none selected)'}
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                            {filteredTrainers.map((trainer: any) => (
                                <label
                                    key={trainer.id}
                                    className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition ${selectedTrainers.includes(trainer.id)
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTrainers.includes(trainer.id)}
                                        onChange={() => handleTrainerToggle(trainer.id)}
                                        className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 truncate">
                                            {trainer.rank} {trainer.name}
                                        </p>
                                        {(trainer.department || trainer.specialization) && (
                                            <p className="text-xs text-gray-600 truncate">
                                                {trainer.department}
                                                {trainer.department && trainer.specialization && ' • '}
                                                {trainer.specialization}
                                            </p>
                                        )}
                                    </div>
                                </label>
                            ))}
                        </div>

                        {filteredTrainers.length === 0 && (
                            <p className="text-sm text-gray-500 text-center py-4">
                                No trainers match the current search/filters.
                            </p>
                        )}
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
