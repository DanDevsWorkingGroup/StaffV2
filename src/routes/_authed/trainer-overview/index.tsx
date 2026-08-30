import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { resolveUserRole, checkRole } from '~/middleware/rbac'
import { useRef, useState } from 'react'
import { DataList, Modal, MonthCalendar, type CalItem, type Column } from '~/components/mobile'

// Server function to get all trainer overview data
const getTrainerOverviewData = createServerFn({ method: 'GET' })
  .inputValidator((data: { trainerId?: number; month: number; year: number }) => data)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()

    // Get all trainers with role info
    const { data: trainers } = await supabase
      .from('trainers')
      .select('*, roles (id, name, level)')
      .eq('is_active', true)  // ✅ CORRECT - Filter by is_active!
      .order('name')

    // Get all roles for the dropdown
    const { data: roles } = await supabase
      .from('roles')
      .select('*')
      .order('level', { ascending: true })

    // Get religious activities for the month
    const startDate = `${data.year}-${String(data.month + 1).padStart(2, '0')}-01`
    const endDate = new Date(data.year, data.month + 1, 0)
    const endDateStr = `${data.year}-${String(data.month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

    const { data: religiousActivities } = await supabase
      .from('religious_activities')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr)

    // Get physical training for the month
    const { data: physicalTraining } = await supabase
      .from('physical_training')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDateStr)

    // Get events for the month
    const { data: events } = await supabase
      .from('events')
      .select('*')
      .or(`start_date.lte.${endDateStr},end_date.gte.${startDate}`)

    // Get schedules for the trainer if selected
    let schedules = []
    if (data.trainerId) {
      const { data: trainerSchedules } = await supabase
        .from('schedules')
        .select('*')
        .eq('trainer_id', data.trainerId)
        .gte('date', startDate)
        .lte('date', endDateStr)
      schedules = trainerSchedules || []
    }

    return {
      trainers: trainers || [],
      roles: roles || [],
      religiousActivities: religiousActivities || [],
      physicalTraining: physicalTraining || [],
      events: events || [],
      schedules: schedules || []
    }
  })

// Server function to create a new trainer
// TEMPORARY WORKAROUND for createTrainer function
// This adds more defensive checks to help identify the issue
// Replace lines 71-123 in your index.tsx

const createTrainer = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    name: string
    rank: string
    role_id: string
    status: string
    email?: string
    password?: string
  }) => data)
  .handler(async ({ data }) => {
    // Only an ADMIN may create accounts; an ADMIN may assign any role, including
    // ADMIN (appointing another administrator is a normal admin action — the
    // AC-6 threat was a non-admin doing it, which the guard above blocks).
    checkRole(await resolveUserRole(), ['ADMIN'])

    const supabase = getSupabaseServerClient()
    const { getSupabaseAdminClient } = await import('~/utils/supabase')
    let userId = null
    let warning = null

    // Validate the requested role against the roles table.
    const { data: role } = await supabase
      .from('roles')
      .select('name')
      .eq('id', data.role_id)
      .single()
    if (!role) {
      return { error: 'Invalid role selected' }
    }

    console.log('🔍 Creating trainer with data:', { 
      name: data.name, 
      rank: data.rank, 
      role_id: data.role_id,
      status: data.status,
      has_email: !!data.email 
    })

    // Try to create auth user if email/password provided
    if (data.email && data.password && data.email.trim() !== '') {
      const supabaseAdmin = getSupabaseAdminClient()
      if (supabaseAdmin) {
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
          email: data.email,
          password: data.password,
          email_confirm: true
        })

        if (userError) {
          console.error('❌ Auth user creation failed:', userError)
          return { error: `User creation failed: ${userError.message}` }
        }
        userId = userData.user?.id
        console.log('✅ Auth user created:', userId)
      } else {
        warning = 'Trainer created without login access (Missing Server Key)'
      }
    } else {
      console.log('ℹ️ No email/password provided - creating trainer without auth')
    }

    // Prepare insert data - explicitly set user_id to null if not provided
    const insertData = {
      name: data.name,
      rank: data.rank,
      role_id: data.role_id,
      status: data.status,
      user_id: userId || null,  // Explicitly set to null instead of omitting
      is_active: true  // Explicitly set is_active
    }

    console.log('📝 Inserting trainer with data:', insertData)

    // Insert the new trainer
    const { data: newTrainer, error } = await supabase
      .from('trainers')
      .insert([insertData])
      .select()
      .single()

    if (error) {
      console.error('❌ Trainer insert failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      })
      
      // Return more detailed error information
      return { 
        error: `Database error: ${error.message}\nCode: ${error.code}\nDetails: ${error.details || 'none'}\nHint: ${error.hint || 'none'}` 
      }
    }

    console.log('✅ Trainer created successfully:', newTrainer.id)
    return { success: true, trainer: newTrainer, warning }
  })

export const Route = createFileRoute('/_authed/trainer-overview/')({
  beforeLoad: ({ context }) => {
    // Check if user exists and has TRAINER role
    if (context.user?.role === 'TRAINER') {
      throw new Error('Unauthorized Access: Trainers cannot access overview')
    }
  },
  loader: async () => {
    const now = new Date()
    return await getTrainerOverviewData({
      data: {
        month: now.getMonth(),
        year: now.getFullYear()
      }
    })
  },
  component: TrainerOverviewPage,
})

// Server function to delete a trainer
const deleteTrainer = createServerFn({ method: 'POST' })
  .inputValidator((data: { trainerId: number }) => data)
  .handler(async ({ data }) => {
    checkRole(await resolveUserRole(), ['ADMIN'])

    const supabase = getSupabaseServerClient()

    // Soft delete
    const { error } = await supabase
      .from('trainers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', data.trainerId)

    if (error) {
      console.error('Error deleting trainer:', error)
      throw new Error('Failed to delete trainer')
    }

    return { success: true }
  })

// ===================================
// PRAYER TIME MAPPINGS (Malaysian Times)
// ===================================
const PRAYER_TIMES: Record<string, { start: string; end: string; displayName: string }> = {
  'Fajr Prayer': { start: '05:30', end: '06:30', displayName: 'Fajr (Subuh)' },
  'Fajr': { start: '05:30', end: '06:30', displayName: 'Fajr (Subuh)' },
  'Subuh': { start: '05:30', end: '06:30', displayName: 'Fajr (Subuh)' },
  'Zohor Prayer': { start: '13:00', end: '14:00', displayName: 'Zohor' },
  'Zohor': { start: '13:00', end: '14:00', displayName: 'Zohor' },
  'Asar Prayer': { start: '16:00', end: '17:00', displayName: 'Asar' },
  'Asar': { start: '16:00', end: '17:00', displayName: 'Asar' },
  'Maghrib Prayer': { start: '19:00', end: '19:30', displayName: 'Maghrib' },
  'Maghrib': { start: '19:00', end: '19:30', displayName: 'Maghrib' },
  'Isya Prayer': { start: '20:00', end: '21:00', displayName: 'Isya' },
  'Isya': { start: '20:00', end: '21:00', displayName: 'Isya\'' },
  'Friday Prayer': { start: '12:30', end: '14:00', displayName: 'Jumaat Prayer' },
  'Jumaat': { start: '12:30', end: '14:00', displayName: 'Jumaat Prayer' },
}

// ===================================
// HELPER FUNCTIONS FOR HOURLY TIMELINE
// ===================================

// Parse time_slot string (e.g., "6:00 PM - 7:00 PM") to 24-hour format
function parseTimeSlot(timeSlot: string): { start: string; end: string } | null {
  if (!timeSlot) return null

  try {
    const parts = timeSlot.split('-').map(p => p.trim())
    if (parts.length !== 2) return null

    const convertTo24Hour = (time: string): string => {
      const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      if (!match) return '00:00'

      let hours = parseInt(match[1])
      const minutes = match[2]
      const period = match[3].toUpperCase()

      if (period === 'PM' && hours !== 12) hours += 12
      if (period === 'AM' && hours === 12) hours = 0

      return `${String(hours).padStart(2, '0')}:${minutes}`
    }

    return {
      start: convertTo24Hour(parts[0]),
      end: convertTo24Hour(parts[1])
    }
  } catch (e) {
    return null
  }
}

// Convert time string (HH:MM) to decimal hours for positioning
function timeToDecimal(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours + minutes / 60
}

// Get prayer time for religious activity
function getPrayerTime(activity: string): { start: string; end: string; displayName: string } {
  // Check exact matches first
  if (PRAYER_TIMES[activity]) {
    return PRAYER_TIMES[activity]
  }

  // Check partial matches (case insensitive)
  const activityLower = activity.toLowerCase()
  for (const [key, value] of Object.entries(PRAYER_TIMES)) {
    if (activityLower.includes(key.toLowerCase())) {
      return value
    }
  }

  // Default to morning time for unknown religious activities
  return { start: '06:00', end: '07:00', displayName: activity }
}

// ===================================
// HOURLY TIMELINE COMPONENT
// ===================================
interface TimelineActivity {
  id: string
  type: 'Religious' | 'Physical' | 'Event'
  title: string
  startTime: string
  endTime: string
  role: string
  color: string
  icon: string
}

function HourlyTimeline({ activities }: { activities: TimelineActivity[] }) {
  const hours = Array.from({ length: 24 }, (_, i) => i)

  // Calculate position and height for each activity
  const positionedActivities = activities.map((activity, index) => {
    const startDecimal = timeToDecimal(activity.startTime)
    const endDecimal = timeToDecimal(activity.endTime)
    const duration = endDecimal - startDecimal

    return {
      ...activity,
      index,
      top: (startDecimal / 24) * 100, // Percentage from top
      height: (duration / 24) * 100,  // Percentage height
      startDecimal,
      endDecimal,
    }
  })

  // Detect overlaps and assign columns
  const activitiesWithColumns = positionedActivities.map((activity, i) => {
    // Find all activities that overlap with this one
    const overlapping = positionedActivities.filter((other, j) => {
      if (i === j) return false
      // Check if time ranges overlap
      return !(other.endDecimal <= activity.startDecimal || other.startDecimal >= activity.endDecimal)
    })

    // Calculate column index (how many overlapping activities start before this one)
    const columnIndex = overlapping.filter(other => other.index < activity.index).length
    const totalColumns = overlapping.length + 1 // Including this activity

    return {
      ...activity,
      columnIndex,
      totalColumns,
    }
  })

  const now = new Date()
  const currentHour = now.getHours() + now.getMinutes() / 60
  const currentTop = (currentHour / 24) * 100

  return (
    <div className="hourly-timeline bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        🕐 Hourly Schedule Timeline
      </h3>

      <div className="relative" style={{ height: '1200px' }}>
        {/* Time labels and grid lines */}
        <div className="absolute inset-0 pointer-events-none">
          {hours.map(hour => (
            <div
              key={hour}
              className="absolute left-0 right-0 border-t border-gray-200"
              style={{ top: `${(hour / 24) * 100}%` }}
            >
              <span className="absolute -left-16 -top-2 text-sm text-gray-600 font-medium">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Activity blocks */}
        <div className="absolute left-0 right-0 top-0 bottom-0 ml-2">
          {activitiesWithColumns.map(activity => {
            // Calculate horizontal position based on column
            const widthPercent = (100 / activity.totalColumns)
            const leftPercent = (activity.columnIndex * widthPercent)

            return (
              <div
                key={activity.id}
                className="absolute rounded-lg p-3 shadow-md border-l-4 cursor-pointer hover:shadow-xl transition-all"
                style={{
                  top: `${activity.top}%`,
                  height: `${Math.max(activity.height, 4)}%`, // Minimum 4% height
                  left: `${leftPercent + 0.5}%`, // Small margin
                  width: `${widthPercent - 1}%`, // Small gap between columns
                  backgroundColor: activity.color + '15',
                  borderLeftColor: activity.color,
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xl flex-shrink-0">{activity.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm truncate">
                      {activity.title}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {activity.startTime} - {activity.endTime}
                    </div>
                    <div
                      className="text-xs mt-1 px-2 py-0.5 rounded-full inline-block"
                      style={{
                        backgroundColor: activity.color,
                        color: 'white'
                      }}
                    >
                      {activity.role}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* No activities message */}
          {positionedActivities.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-4xl mb-2">📅</div>
                <div className="text-lg">No activities scheduled for this day</div>
              </div>
            </div>
          )}
        </div>

        {/* Current time indicator */}
        <div
          className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-10"
          style={{ top: `${currentTop}%` }}
        >
          <div className="absolute -left-2 -top-2 w-4 h-4 bg-red-500 rounded-full"></div>
          <span className="absolute right-2 -top-2 text-xs text-red-500 font-bold">
            NOW
          </span>
        </div>
      </div>
    </div>
  )
}

// ===================================
// MAIN COMPONENT
// ===================================
function TrainerOverviewPage() {
  const initialData = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [trainers, setTrainers] = useState(initialData.trainers)
  const [roles] = useState(initialData.roles || [])
  const [selectedTrainer, setSelectedTrainer] = useState<number | null>(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<'directory' | 'dashboard'>('directory')
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRank, setFilterRank] = useState('')
  const [filterSpecialization, setFilterSpecialization] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  // State for fetched data
  const [religiousActivities, setReligiousActivities] = useState(initialData.religiousActivities)
  const [physicalTraining, setPhysicalTraining] = useState(initialData.physicalTraining)
  const [events, setEvents] = useState(initialData.events)
  const [schedules, setSchedules] = useState(initialData.schedules)

  // Reload data when trainer or month changes
  const reloadData = async (trainerId: number | null, month: number, year: number) => {
    const data = await getTrainerOverviewData({
      data: { trainerId: trainerId || undefined, month, year }
    })
    setTrainers(data.trainers) // Update trainers list in case status changed
    setReligiousActivities(data.religiousActivities)
    setPhysicalTraining(data.physicalTraining)
    setEvents(data.events)
    setSchedules(data.schedules)
  }

  // Handle trainer selection
  const handleTrainerChange = async (trainerId: string) => {
    const id = trainerId ? parseInt(trainerId) : null
    setSelectedTrainer(id)
    setSelectedDate(null)
    if (id) {
      setViewMode('dashboard')
      await reloadData(id, currentDate.getMonth(), currentDate.getFullYear())
    }
  }

  const handleViewTrainer = async (trainerId: number) => {
    setSelectedTrainer(trainerId)
    setViewMode('dashboard')
    await reloadData(trainerId, currentDate.getMonth(), currentDate.getFullYear())
  }

  // Handle month change
  const handleMonthChange = async (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    if (direction === 'prev') {
      newDate.setMonth(currentDate.getMonth() - 1)
    } else {
      newDate.setMonth(currentDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
    setSelectedDate(null)
    if (selectedTrainer) {
      await reloadData(selectedTrainer, newDate.getMonth(), newDate.getFullYear())
    }
  }

  // Get selected trainer object
  const trainer = trainers.find(t => t.id === selectedTrainer)

  // Calculate monthly summary
  const getMonthlySummary = () => {
    if (!selectedTrainer) {
      return { religious: 0, events: 0, physical: 0, leadership: 0 }
    }

    // Count religious activities
    const religious = religiousActivities.filter((activity: any) =>
      activity.in_charge === trainer?.name ||
      activity.participants.includes(selectedTrainer)
    ).length

    // Count events (check if trainer has schedule during event period)
    const eventCount = events.filter((event: any) => {
      const eventStart = new Date(event.start_date)
      const eventEnd = new Date(event.end_date)
      return schedules.some((schedule: any) => {
        const scheduleDate = new Date(schedule.date)
        return scheduleDate >= eventStart && scheduleDate <= eventEnd
      })
    }).length

    // Count physical training
    const physical = physicalTraining.filter((training: any) =>
      training.in_charge === trainer?.name ||
      training.participants.includes(selectedTrainer)
    ).length

    // Count leadership roles
    const leadership =
      religiousActivities.filter((a: any) => a.in_charge === trainer?.name).length +
      physicalTraining.filter((t: any) => t.in_charge === trainer?.name).length

    return { religious, events: eventCount, physical, leadership }
  }

  // Get activities for a specific date (simple version for calendar)
  const getActivitiesForDate = (day: number) => {
    if (!selectedTrainer) return []

    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const activities: any[] = []

    // Check religious activities
    religiousActivities.forEach((activity: any) => {
      if (activity.date === dateStr) {
        if (activity.in_charge === trainer?.name) {
          activities.push({
            type: 'Religious Activity',
            time: 'Morning',
            activity: activity.activity,
            role: 'Leader/Imam',
            color: '#22c55e'
          })
        } else if (activity.participants.includes(selectedTrainer)) {
          activities.push({
            type: 'Religious Activity',
            time: 'Morning',
            activity: activity.activity,
            role: 'Participant',
            color: '#86efac'
          })
        }
      }
    })

    // Check events
    events.forEach((event: any) => {
      const eventStart = new Date(event.start_date)
      const eventEnd = new Date(event.end_date)
      const checkDate = new Date(dateStr)

      if (checkDate >= eventStart && checkDate <= eventEnd) {
        activities.push({
          type: 'Event',
          time: 'Full Day',
          activity: event.name,
          role: 'Assigned',
          color: '#3b82f6'
        })
      }
    })

    // Check physical training
    physicalTraining.forEach((training: any) => {
      if (training.date === dateStr) {
        if (training.in_charge === trainer?.name) {
          activities.push({
            type: 'Physical Training',
            time: training.time_slot || 'All Day',
            activity: training.training_type,
            role: 'In Charge',
            color: '#f97316'
          })
        } else if (training.participants.includes(selectedTrainer)) {
          activities.push({
            type: 'Physical Training',
            time: training.time_slot || 'All Day',
            activity: training.training_type,
            role: 'Participant',
            color: '#fb923c'
          })
        }
      }
    })

    return activities
  }

  // ===================================
  // NEW: Get timeline activities for hourly schedule
  // ===================================
  const getTimelineActivities = (day: number): TimelineActivity[] => {
    if (!selectedTrainer) return []

    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const timelineActivities: TimelineActivity[] = []

    // 1. RELIGIOUS ACTIVITIES - Use prayer time mappings
    religiousActivities.forEach((activity: any) => {
      if (activity.date === dateStr) {
        const isInCharge = activity.in_charge === trainer?.name
        const isParticipant = activity.participants.includes(selectedTrainer)

        if (isInCharge || isParticipant) {
          const prayerTime = getPrayerTime(activity.activity)

          timelineActivities.push({
            id: `religious-${activity.id}`,
            type: 'Religious',
            title: prayerTime.displayName,
            startTime: prayerTime.start,
            endTime: prayerTime.end,
            role: isInCharge ? 'Leader/Imam' : 'Participant',
            color: isInCharge ? '#22c55e' : '#86efac',
            icon: '🕌'
          })
        }
      }
    })

    // 2. PHYSICAL TRAINING - Use time_slot from database
    physicalTraining.forEach((training: any) => {
      if (training.date === dateStr) {
        const isInCharge = training.in_charge === trainer?.name
        const isParticipant = training.participants.includes(selectedTrainer)

        if (isInCharge || isParticipant) {
          const timeSlot = parseTimeSlot(training.time_slot)

          if (timeSlot) {
            timelineActivities.push({
              id: `physical-${training.id}`,
              type: 'Physical',
              title: training.training_type,
              startTime: timeSlot.start,
              endTime: timeSlot.end,
              role: isInCharge ? 'In Charge' : 'Participant',
              color: isInCharge ? '#f97316' : '#fb923c',
              icon: '💪'
            })
          }
        }
      }
    })

    // 3. EVENTS - Show as multi-hour blocks (8 AM - 5 PM by default)
    events.forEach((event: any) => {
      const eventStart = new Date(event.start_date)
      const eventEnd = new Date(event.end_date)
      const checkDate = new Date(dateStr)

      if (checkDate >= eventStart && checkDate <= eventEnd) {
        const hasSchedule = schedules.some((schedule: any) => {
          const scheduleDate = new Date(schedule.date)
          return scheduleDate.toDateString() === checkDate.toDateString()
        })

        if (hasSchedule) {
          timelineActivities.push({
            id: `event-${event.id}`,
            type: 'Event',
            title: event.name,
            startTime: '08:00',
            endTime: '17:00',
            role: 'Assigned',
            color: event.color || '#3b82f6',
            icon: '📅'
          })
        }
      }
    })

    // Sort by start time
    return timelineActivities.sort((a, b) =>
      timeToDecimal(a.startTime) - timeToDecimal(b.startTime)
    )
  }

  // Generate calendar days
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const days = []
    for (let i = 0; i < firstDay; i++) {
      days.push(null)
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }
    return days
  }

  // Enhanced filtering with rank, specialization, and department
const filteredTrainersEnhanced = trainers.filter((t: any) => {
  const searchLower = searchQuery.toLowerCase()
  const matchesSearch = (
    t.name.toLowerCase().includes(searchLower) ||
    (t.rank || '').toLowerCase().includes(searchLower) ||
    (t.roles?.name || '').toLowerCase().includes(searchLower)
  )
  const matchesRank = !filterRank || t.rank === filterRank
  const matchesSpecialization = !filterSpecialization || t.specialization === filterSpecialization
  const matchesDepartment = !filterDepartment || t.department === filterDepartment
  
  return matchesSearch && matchesRank && matchesSpecialization && matchesDepartment
})

  // Handler for deleting trainer
  const handleDelete = async (trainerId: number) => {
    try {
      await deleteTrainer({ data: { trainerId } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to delete trainer:', error)
      alert('Failed to delete trainer. Please try again.')
    }
  }

  const summary = getMonthlySummary()
  const days = getDaysInMonth()

  return (
    <div>
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-red-800 text-white rounded-xl shadow-lg p-5 mb-6 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-balance text-2xl font-bold sm:text-3xl">Trainer Overview &amp; Management</h1>
            <p className="text-red-100 mt-1 text-sm sm:text-base">Monitor trainer activities and manage staff</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <button
              onClick={() => setViewMode('directory')}
              className={`min-h-11 rounded-lg px-4 py-2 font-semibold transition ${viewMode === 'directory'
                  ? 'bg-white text-red-700'
                  : 'bg-red-500 text-white hover:bg-red-400'
                }`}
            >
              Directory
            </button>
            <button
              onClick={() => setViewMode('dashboard')}
              className={`min-h-11 rounded-lg px-4 py-2 font-semibold transition ${viewMode === 'dashboard'
                  ? 'bg-white text-red-700'
                  : 'bg-red-500 text-white hover:bg-red-400'
                }`}
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>

     {/* DIRECTORY VIEW - ENHANCED with Filtering and Profile Links */}
{viewMode === 'directory' && (
  <>
    {/* Filters Section */}
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">🔍 Search & Filter</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Search */}
        <div className="lg:col-span-2">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Search by Name
          </label>
          <input
            type="text"
            placeholder="Search trainers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
          />
        </div>

        {/* Rank Filter */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filter by Rank
          </label>
          <select
            value={filterRank}
            onChange={(e) => setFilterRank(e.target.value)}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
          >
            <option value="">All Ranks</option>
            {Array.from(new Set(trainers.map((t: any) => t.rank).filter(Boolean))).sort().map((rank: any) => (
              <option key={rank} value={rank}>{rank}</option>
            ))}
          </select>
        </div>

        {/* Specialization Filter */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filter by Specialization
          </label>
          <select
            value={filterSpecialization}
            onChange={(e) => setFilterSpecialization(e.target.value)}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
          >
            <option value="">All Specializations</option>
            {Array.from(new Set(trainers.map((t: any) => t.specialization).filter(Boolean))).sort().map((spec: any) => (
              <option key={spec} value={spec}>{spec}</option>
            ))}
          </select>
        </div>

        {/* Department Filter */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filter by Department
          </label>
          <select
            value={filterDepartment}
            onChange={(e) => setFilterDepartment(e.target.value)}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-teal-500 focus:outline-none"
          >
            <option value="">All Departments</option>
            {Array.from(new Set(trainers.map((t: any) => t.department).filter(Boolean))).sort().map((dept: any) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Filters Summary */}
      {(searchQuery || filterRank || filterSpecialization || filterDepartment) && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
          {searchQuery && (
            <span className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm">
              Search: "{searchQuery}"
              <button onClick={() => setSearchQuery('')} className="ml-2">✕</button>
            </span>
          )}
          {filterRank && (
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
              Rank: {filterRank}
              <button onClick={() => setFilterRank('')} className="ml-2">✕</button>
            </span>
          )}
          {filterSpecialization && (
            <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
              Spec: {filterSpecialization}
              <button onClick={() => setFilterSpecialization('')} className="ml-2">✕</button>
            </span>
          )}
          {filterDepartment && (
            <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
              Dept: {filterDepartment}
              <button onClick={() => setFilterDepartment('')} className="ml-2">✕</button>
            </span>
          )}
          <button
            onClick={() => {
              setSearchQuery('')
              setFilterRank('')
              setFilterSpecialization('')
              setFilterDepartment('')
            }}
            className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold hover:bg-red-200"
          >
            Clear All
          </button>
        </div>
      )}

      {/* Results Count */}
      <div className="mt-4 text-sm text-gray-600">
        Showing <span className="font-bold text-gray-900">{filteredTrainersEnhanced.length}</span> of <span className="font-bold text-gray-900">{trainers.length}</span> trainers
      </div>
    </div>

    {/* Trainer Directory Table */}
    <div className="bg-white rounded-lg shadow-lg">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">Trainer Directory</h2>
        {user?.role === 'ADMIN' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white transition hover:bg-teal-700"
          >
            <span className="text-xl">+</span> Add New
          </button>
        )}
      </div>

      <div className="p-3 sm:p-4">
        <DataList<any>
          rows={filteredTrainersEnhanced}
          getKey={(t) => t.id}
          empty="No trainers found. Try adjusting your search or filters."
          columns={[
            {
              key: 'name',
              header: 'Trainer',
              primary: true,
              cell: (t) => (
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                    {t.name.charAt(0)}
                  </span>
                  <Link
                    to="/trainer-overview/$id"
                    params={{ id: t.id.toString() }}
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    {t.name}
                  </Link>
                </span>
              ),
            },
            { key: 'rank', header: 'Rank', cell: (t) => t.rank || '-' },
            { key: 'department', header: 'Department', cell: (t) => t.department || '-' },
            {
              key: 'role',
              header: 'Role',
              cell: (t) => (
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    t.roles?.name === 'ADMIN'
                      ? 'bg-purple-100 text-purple-800'
                      : t.roles?.name === 'COORDINATOR'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-green-100 text-green-800'
                  }`}
                >
                  {t.roles?.name || 'TRAINER'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (t) => (
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    t.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {t.status || 'active'}
                </span>
              ),
            },
          ] as Column<any>[]}
          actions={(t) => (
            <>
              <button
                onClick={() => handleViewTrainer(t.id)}
                className="min-h-9 rounded-md px-3 text-sm font-semibold text-blue-600 hover:bg-blue-50"
              >
                View Schedule
              </button>
              {user?.role === 'ADMIN' && (
                <>
                  <Link
                    to="/trainer-overview/edit/$id"
                    params={{ id: t.id.toString() }}
                    className="min-h-9 rounded-md px-3 text-sm font-semibold text-orange-600 hover:bg-orange-50"
                  >
                    Edit
                  </Link>
                  {deleteConfirm === t.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="min-h-9 rounded-md px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
                      >
                        Confirm?
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="min-h-9 rounded-md px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(t.id)}
                      className="min-h-9 rounded-md px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </>
          )}
        />
      </div>
    </div>
  </>
)}


      {/* DASHBOARD VIEW */}
      {viewMode === 'dashboard' && (
        <>
          {/* Trainer Selection */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selected Trainer
                </label>
                <select
                  value={selectedTrainer || ''}
                  onChange={(e) => handleTrainerChange(e.target.value)}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="">-- Select a Trainer --</option>
                  {trainers.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.rank} {t.name} - {t.roles?.name || 'TRAINER'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Month & Year
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleMonthChange('prev')}
                    className="p-3 border-2 border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    ◀
                  </button>
                  <div className="flex-1 text-center p-3 border-2 border-gray-300 rounded-lg font-semibold">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </div>
                  <button
                    onClick={() => handleMonthChange('next')}
                    className="p-3 border-2 border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    ▶
                  </button>
                </div>
              </div>
            </div>
          </div>

          {selectedTrainer ? (
            <>
              {/* Monthly Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <SummaryCard
                  title="Religious Activities"
                  value={summary.religious}
                  icon="🕌"
                  color="bg-teal-500"
                />
                <SummaryCard
                  title="Event Dates"
                  value={summary.events}
                  icon="📅"
                  color="bg-blue-500"
                />
                <SummaryCard
                  title="Physical Training"
                  value={summary.physical}
                  icon="💪"
                  color="bg-orange-500"
                />
                <SummaryCard
                  title="Leadership Roles"
                  value={summary.leadership}
                  icon="⭐"
                  color="bg-yellow-500"
                />
              </div>

              {/* Monthly Calendar */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">
                  Monthly Summary for {trainer?.rank} {trainer?.name}
                </h3>

                <MonthCalendar
                  monthDate={currentDate}
                  accentClass="text-blue-700"
                  todayRingClass="border-blue-600 bg-blue-50"
                  onDayClick={(day) =>
                    setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))
                  }
                  getItems={(day) => {
                    const dayActivities = getActivitiesForDate(day)
                    const pick = (a: any) =>
                      a.type === 'Religious Activity' ? '🕌' : a.type === 'Physical Training' ? '💪' : '📅'
                    return dayActivities.map((a: any, idx: number): CalItem => ({
                      key: idx,
                      label: `${pick(a)} ${a.activity}`,
                      color: a.color,
                      onClick: () =>
                        setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day)),
                    }))
                  }}
                />
              </div>

              {/* NEW: Hourly Timeline Schedule */}
              {selectedDate && (
                <>
                  <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      Daily Schedule for {trainer?.rank} {trainer?.name}
                    </h3>
                    <p className="text-gray-600 mb-4">
                      {selectedDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>

                  <HourlyTimeline activities={getTimelineActivities(selectedDate.getDate())} />

                  {/* Daily Summary Stats */}
                  <div className="bg-white rounded-lg shadow p-6 mt-6">
                    <h4 className="font-semibold text-gray-900 mb-4">Daily Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {getTimelineActivities(selectedDate.getDate()).length}
                        </div>
                        <div className="text-sm text-gray-600">Total Activities</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {getTimelineActivities(selectedDate.getDate()).filter(a => a.role.includes('In Charge') || a.role.includes('Leader')).length}
                        </div>
                        <div className="text-sm text-gray-600">Leadership Roles</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {getTimelineActivities(selectedDate.getDate()).filter(a => a.role === 'Participant').length}
                        </div>
                        <div className="text-sm text-gray-600">Participations</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <div className="text-6xl mb-4">👥</div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Select a Trainer
              </h3>
              <p className="text-gray-600">
                Choose a trainer from the dropdown above to view their activity overview and schedule
              </p>
            </div>
          )}
        </>
      )}

      {/* Add Trainer Modal */}
      {showAddModal && (
        <AddTrainerModal
          roles={roles}
          onClose={() => setShowAddModal(false)}
          onSubmit={createTrainer}
        />
      )}
    </div>
  )
}

function AddTrainerModal({
  roles,
  onClose,
  onSubmit
}: {
  roles: any[]
  onClose: () => void
  onSubmit: any
}) {
  const [formData, setFormData] = useState({
    name: '',
    rank: '',
    email: '',
    password: '',
    role_id: roles.find(r => r.name === 'TRAINER')?.id || '',
    status: 'active'
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const inputClass =
    'w-full min-h-11 rounded-lg border px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 sm:text-sm'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await onSubmit({ data: formData })

      if (result.error) {
        setError(result.error)
      } else {
        if (result.warning) {
          alert(result.warning)
        }
        window.location.reload()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create trainer')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formId = 'add-trainer-form'

  return (
    <Modal
      open
      onClose={onClose}
      title="Add New Trainer"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isSubmitting}
            className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Trainer'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Full Name</label>
          <input
            ref={nameRef}
            type="text"
            required
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            className={inputClass}
            placeholder="e.g. Ahmad Tarmizi"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Rank</label>
          <input
            type="text"
            required
            value={formData.rank}
            onChange={e => setFormData({ ...formData, rank: e.target.value })}
            className={inputClass}
            placeholder="e.g. KB41"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email <span className="font-normal text-gray-400">(Optional)</span></label>
          <input
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={e => setFormData({ ...formData, email: e.target.value })}
            className={inputClass}
            placeholder="ahmad.faiz@abpm.gov.my"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password <span className="font-normal text-gray-400">(Optional)</span></label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={e => setFormData({ ...formData, password: e.target.value })}
              className={`${inputClass} pr-12`}
              placeholder="Min. 6 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500 hover:text-gray-700"
            >
              <span className="text-xl">{showPassword ? '👁️' : '🔒'}</span>
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
          <select
            value={formData.role_id}
            onChange={e => setFormData({ ...formData, role_id: e.target.value })}
            className={inputClass}
          >
            <option value="">Select Role</option>
            {roles.map((role: any) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
          <select
            value={formData.status}
            onChange={e => setFormData({ ...formData, status: e.target.value })}
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="lead">Lead</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <p className="text-xs text-gray-500">
          Email and Password are required to create a login capability for the trainer.
        </p>
      </form>
    </Modal>
  )
}

// Summary Card Component
function SummaryCard({
  title,
  value,
  icon,
  color
}: {
  title: string
  value: number
  icon: string
  color: string
}) {
  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`${color} text-white p-3 rounded-lg text-2xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}