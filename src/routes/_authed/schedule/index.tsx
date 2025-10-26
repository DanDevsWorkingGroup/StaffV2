import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '~/utils/supabase'
import { useState } from 'react'

// Server function to fetch schedule data
const getScheduleData = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  
  // Fetch all training sessions for the current month
  const currentDate = new Date()
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  
  const { data: sessions, error } = await supabase
    .from('training_sessions')
    .select(`
      *,
      trainer:trainers(id, name, rank)
    `)
    .gte('date', firstDay.toISOString().split('T')[0])
    .lte('date', lastDay.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const { data: trainers } = await supabase
    .from('trainers')
    .select('*')
    .eq('status', 'active')

  // Get quick stats
  const todayStr = currentDate.toISOString().split('T')[0]
  const todaySessions = sessions?.filter(s => s.date === todayStr) || []
  
  return {
    sessions: sessions || [],
    trainers: trainers || [],
    stats: {
      activeTrainers: trainers?.length || 0,
      todaySessions: todaySessions.length,
      thisWeekSessions: sessions?.length || 0,
    }
  }
})

export const Route = createFileRoute('/_authed/schedule/')({
  loader: async () => await getScheduleData(),
  component: SchedulePage,
})

function SchedulePage() {
  const { sessions, trainers, stats } = Route.useLoaderData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<'week' | 'month'>('week')

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Training Schedule</h1>
        <p className="text-gray-600">Manage and view all training schedules</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Active Trainers" 
          value={stats.activeTrainers} 
          icon="👥" 
          color="bg-blue-500"
        />
        <StatCard 
          title="Today's Sessions" 
          value={stats.todaySessions} 
          icon="📅" 
          color="bg-green-500"
        />
        <StatCard 
          title="This Week" 
          value={stats.thisWeekSessions} 
          icon="📊" 
          color="bg-purple-500"
        />
      </div>

      {/* Calendar Controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() - 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded"
            >
              ◀
            </button>
            <h2 className="text-xl font-semibold">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              onClick={() => {
                const newDate = new Date(currentDate)
                newDate.setMonth(currentDate.getMonth() + 1)
                setCurrentDate(newDate)
              }}
              className="p-2 hover:bg-gray-100 rounded"
            >
              ▶
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => setView('week')}
              className={`px-4 py-2 rounded ${
                view === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-4 py-2 rounded ${
                view === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-200'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {view === 'week' ? (
          <WeeklyCalendar sessions={sessions} currentDate={currentDate} />
        ) : (
          <MonthlyCalendar sessions={sessions} currentDate={currentDate} />
        )}
      </div>

      {/* Trainer List Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">Active Trainers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map((trainer: any) => (
            <div key={trainer.id} className="p-4 border rounded-lg hover:shadow-md transition">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-xl">👤</span>
                </div>
                <div>
                  <p className="font-semibold">{trainer.name}</p>
                  <p className="text-sm text-gray-600">{trainer.rank}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Stat Card Component
function StatCard({ title, value, icon, color }: { 
  title: string; 
  value: number; 
  icon: string; 
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <div className={`${color} w-16 h-16 rounded-full flex items-center justify-center text-3xl`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// Weekly Calendar View
function WeeklyCalendar({ sessions, currentDate }: { sessions: any[]; currentDate: Date }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  
  // Get current week dates
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
  startOfWeek.setDate(diff)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => (
          <div key={day} className="text-center">
            <div className="font-semibold text-gray-700">{day}</div>
            <div className="text-2xl font-bold text-gray-900 mt-2">
              {weekDates[idx].getDate()}
            </div>
            <div className="mt-4 space-y-2">
              {sessions
                .filter(s => {
                  const sessionDate = new Date(s.date)
                  return sessionDate.toDateString() === weekDates[idx].toDateString()
                })
                .map(session => (
                  <div 
                    key={session.id} 
                    className="bg-blue-100 text-blue-800 text-xs p-2 rounded"
                  >
                    <div className="font-semibold">{session.type}</div>
                    <div className="text-xs">{session.trainer?.name}</div>
                  </div>
                ))
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Monthly Calendar View
function MonthlyCalendar({ sessions, currentDate }: { sessions: any[]; currentDate: Date }) {
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  const startDay = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const calendar = []

  // Add empty cells for days before month starts
  for (let i = 0; i < startDay; i++) {
    calendar.push(null)
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendar.push(day)
  }

  return (
    <div className="p-4">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {days.map(day => (
          <div key={day} className="text-center font-semibold text-gray-700 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {calendar.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="aspect-square" />
          }

          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const daySessions = sessions.filter(s => s.date === dateStr)

          return (
            <div 
              key={day} 
              className="aspect-square border rounded-lg p-2 hover:shadow-md transition cursor-pointer"
            >
              <div className="font-semibold text-gray-900">{day}</div>
              <div className="mt-1 space-y-1">
                {daySessions.slice(0, 2).map(session => (
                  <div 
                    key={session.id} 
                    className="bg-green-100 text-green-800 text-xs p-1 rounded truncate"
                    title={session.type}
                  >
                    {session.type.substring(0, 10)}
                  </div>
                ))}
                {daySessions.length > 2 && (
                  <div className="text-xs text-gray-600">
                    +{daySessions.length - 2} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}